# SkillsCat Workers 架构文档

## 概述

SkillsCat 使用 Cloudflare Workers 构建了一套完整的后台处理系统，负责 skill 的发现、入库、分类、评分和生命周期管理。

## Workers 清单

| Worker | 文件 | 触发方式 | 职责 |
|--------|------|---------|------|
| github-events | `workers/github-events.ts` | Cron (每5分钟) | 轮询 GitHub Events API 发现新 SKILL.md |
| indexing | `workers/indexing.ts` | Queue Consumer | 获取仓库信息，入库 D1，缓存 R2 |
| classification | `workers/classification.ts` | Queue Consumer | AI/关键词分类 |
| trending | `workers/trending.ts` | Cron (每小时) | 计算 trending score，批量更新 |
| tier-recalc | `workers/tier-recalc.ts` | Cron (每天3点) | 重算 tier，重置访问计数 |
| archive | `workers/archive.ts` | Cron (每月1号) | 归档冷数据到 R2 |
| resurrection | `workers/resurrection.ts` | Cron (每季度) + HTTP | 复活归档 skills |

---

## 数据流图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         触发入口                                      │
├─────────────────────────────────────────────────────────────────────┤
│  1. GitHub Events API (自动发现)                                      │
│  2. 用户提交 URL (/api/submit)                                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ INDEXING_QUEUE │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │   Indexing     │ → D1 (skills, authors)
                    │    Worker      │ → R2 (SKILL.md cache)
                    └────────┬───────┘
                             │
                             ▼
                    ┌─────────────────────┐
                    │ CLASSIFICATION_QUEUE │
                    └────────┬────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Classification │ → D1 (skill_categories)
                    │    Worker      │
                    └────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Trending   │    │  Tier Recalc │    │   Archive    │
│   (每小时)    │    │   (每天)      │    │   (每月)     │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                               │
                                               ▼
                                       ┌──────────────┐
                                       │ Resurrection │
                                       │   (每季度)    │
                                       └──────────────┘
```

---

## 各 Worker 详细说明

### 1. GitHub Events Worker (`github-events.ts`)

**触发**: Cron (每5分钟)

**职责**:
- 轮询 GitHub Public Events API
- 过滤 PushEvent 类型事件
- 提取仓库信息发送到 indexing 队列
- 使用 KV 记录已处理的事件 ID，避免重复处理

**数据流**:
```
GitHub Events API → 过滤 PushEvent → INDEXING_QUEUE
```

**KV 键**:
- `github-events:last-event-id`: 最后处理的事件 ID
- `github-events:processed:{eventId}`: 已处理事件标记 (TTL: 7天)

---

### 2. Indexing Worker (`indexing.ts`)

**触发**: Queue Consumer (INDEXING_QUEUE)

**职责**:
- 检查仓库是否包含 SKILL.md (仅根目录，排除 .claude/ 等)
- 获取仓库元数据 (stars, forks, topics 等)
- 创建/更新 skill 记录到 D1
- 缓存 SKILL.md 内容到 R2
- 反滥用: 计算内容哈希，检测高星仓库的复制品
- 发送到 classification 队列

**数据流**:
```
INDEXING_QUEUE → GitHub API → D1 (skills, authors) → R2 (SKILL.md) → CLASSIFICATION_QUEUE
```

**反滥用机制**:
- 计算 SKILL.md 的 SHA-256 哈希 (原始 + 标准化)
- 新 skill (stars < 100) 检查是否复制高星 (>= 1000) skill
- 存储哈希到 `content_hashes` 表

---

### 3. Classification Worker (`classification.ts`)

**触发**: Queue Consumer (CLASSIFICATION_QUEUE)

**职责**:
- 根据仓库质量决定分类方法:
  - **AI 分类**: stars >= 100 或 known orgs
  - **关键词分类**: 有足够 topics 或 description
  - **跳过**: 低质量仓库 (stars < 10, 无 topics, 短 description)
- 调用 OpenRouter/DeepSeek API 进行 AI 分类
- 保存分类结果到 `skill_categories` 表

**分类方法决策**:
```
stars >= 100 → AI
known org → AI
topics >= 2 → keyword
description > 50 chars → keyword
stars < 10 && no metadata → skipped
default → keyword
```

**成本优化**: 预计减少 ~85% AI API 调用

**KV 键**:
- `metrics:classification:{hour}`: 分类统计 (ai/keyword/skipped 计数)

---

### 4. Trending Worker (`trending.ts`)

**触发**: Cron (每小时)

**职责**:
- 使用 GitHub GraphQL API 批量获取仓库数据 (50个/请求)
- 计算 trending score (基于 stars, 增长速度, 活跃度)
- 按 tier 分层更新:
  - Hot: 每6小时
  - Warm: 每24小时
  - Cool: 每7天
  - Cold: 仅用户访问时
- 生成列表缓存 (trending.json, top.json, recent.json)

**Trending Score 算法**:
```
baseScore = log10(stars + 1) * 10
velocityMultiplier = 1 + log2(dailyGrowth7d + 1) * acceleration * 0.4
recencyBoost = max(1.0, 1.5 - daysSinceIndexed / 14)
activityPenalty = 基于 lastCommitAt 的衰减
score = baseScore * velocityMultiplier * recencyBoost * activityPenalty
```

**GraphQL vs REST**:
- REST: 50个仓库 = 50次请求
- GraphQL: 50个仓库 = 1次请求
- 节省 98% API 调用量

---

### 5. Tier Recalculation Worker (`tier-recalc.ts`)

**触发**: Cron (每天 UTC 3:00)

**职责**:
- 重置过期的访问计数 (7d, 30d)
- 重新计算所有 skill 的 tier
- 识别归档候选 (1年无访问 + stars < 5 + 2年无提交)

**Tier 定义**:
| Tier | Stars 阈值 | 访问窗口 | 更新频率 |
|------|-----------|---------|---------|
| hot | >= 1000 | 7天内访问 | 6小时 |
| warm | >= 100 | 30天内访问 | 24小时 |
| cool | >= 10 | 90天内访问 | 7天 |
| cold | < 10 | 1年内访问 | 仅访问时 |
| archived | - | - | 永不 |

---

### 6. Archive Worker (`archive.ts`)

**触发**: Cron (每月1号)

**职责**:
- 查找归档候选:
  - 1年无访问
  - stars < 5
  - 2年无提交
- 将 skill 数据打包存储到 R2 (`archive/{year}/{month}/{id}.json`)
- 删除原始 SKILL.md 缓存 (节省存储)
- 删除 `skill_categories` 记录 (节省 D1 存储)
- 更新 skill tier 为 'archived'

**归档数据结构**:
```json
{
  "id": "...",
  "name": "...",
  "slug": "...",
  "categories": ["git", "automation"],
  "skillMdContent": "...",
  "archivedAt": "2024-01-01T00:00:00Z"
}
```

**HTTP 端点**:
- `POST /restore`: 手动恢复归档 skill (需 WORKER_SECRET)

---

### 7. Resurrection Worker (`resurrection.ts`)

**触发**:
- Cron (每季度)
- HTTP POST `/check` (用户访问触发)

**职责**:
- 季度批量检查: 遍历所有 archived skills
- 用户访问检查: 单个 skill 即时检查
- 复活条件:
  - 季度检查: stars >= 50 或 90天内有提交
  - 用户访问: stars >= 20 或 90天内有提交
  - 用户提交 URL: 无阈值，直接复活

**复活流程**:
1. 从 R2 获取归档数据
2. 恢复 SKILL.md 到 R2
3. 更新 skill tier 为 'cold'
4. 恢复 `skill_categories` 记录
5. 删除归档文件

---

## 共享资源

### D1 Database

**主要表**:
- `skills`: skill 元数据
- `authors`: 作者信息
- `skill_categories`: skill-category 关联
- `content_hashes`: 内容哈希 (反滥用)
- `user_actions`: 用户行为记录

### R2 Storage

**路径结构**:
```
skills/{owner}/{repo}/SKILL.md    # SKILL.md 缓存
cache/trending.json               # Trending 列表缓存
cache/top.json                    # Top 列表缓存
cache/recent.json                 # Recent 列表缓存
archive/{year}/{month}/{id}.json  # 归档数据
```

### KV Namespace

**键前缀**:
- `github-events:*`: 事件追踪
- `needs_update:*`: 用户访问触发的更新标记
- `metrics:*`: 各 worker 的统计指标

---

## 复活触发方式汇总

| 触发方式 | 阈值 | 说明 |
|---------|------|------|
| 季度批量检查 | stars >= 50 OR 90天活跃 | 高阈值，避免误复活 |
| 用户访问详情页 | stars >= 20 OR 90天活跃 | 有人关注说明有价值 |
| 用户提交 URL | 无阈值，直接复活 | 用户主动提交 = 强信号 |

---

## 成本优化策略

1. **分层更新**: 按 tier 分配更新频率，冷数据不主动更新
2. **GraphQL 批量查询**: 50个仓库/请求，节省 98% API 调用
3. **分类方法分层**: 低质量仓库跳过 AI 分类，节省 ~85% AI 成本
4. **归档机制**: 冷数据归档到 R2，释放 D1 存储
5. **用户驱动更新**: cold tier 仅在用户访问时更新

---

## 监控指标

各 Worker 都提供 `/metrics` 端点:

- **classification**: ai/keyword/skipped 计数
- **trending**: 各 tier 更新数量, GitHub API 调用数
- **tier-recalc**: 各 tier 分布, 变更数量
- **archive**: 归档数量, 失败数量
- **resurrection**: 检查数量, 复活数量

---

## 配置文件

| Worker | 配置文件 |
|--------|---------|
| web | `wrangler.preview.toml` |
| github-events | `wrangler.github-events.toml` |
| indexing | `wrangler.indexing.toml` |
| classification | `wrangler.classification.toml` |
| trending | `wrangler.trending.toml` |
| tier-recalc | `wrangler.tier-recalc.toml` |
| archive | `wrangler.archive.toml` |
| resurrection | `wrangler.resurrection.toml` |
