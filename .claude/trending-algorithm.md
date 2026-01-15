# Trending 指数计算方案

## 一、Cloudflare 定价约束

### Workers (Paid Plan)
- 请求: $0.30 / 百万次
- CPU: $0.02 / 百万毫秒
- 基础费: $5/月

### D1 (Paid Plan 包含额度)
- 读取: 25B 行/月免费，超出 $0.001 / 百万行
- 写入: 50M 行/月免费，超出 $1.00 / 百万行 ⚠️ **写入很贵**
- 存储: 5GB 免费，超出 $0.75/GB
- **限制**: 不支持传统事务，使用 `db.batch()` 实现原子批量操作 (最多 100 条语句)

### R2
- 存储: $0.015/GB/月
- Class A (写入): $4.50 / 百万次
- Class B (读取): $0.36 / 百万次
- 出口流量: **免费**

### Queues
- 操作: $0.40 / 百万次 (64KB/操作)
- 一条消息完整传递 ≈ 3 次操作 (写+读+确认) = $1.20 / 百万消息
- 免费额度: 100万次操作/月

### GitHub API
- 认证请求: 5,000 次/小时
- 搜索 API: 30 次/分钟

---

## 二、成本优化核心原则

### 2.1 最小化 D1 写入
D1 写入是最贵的操作 ($1/百万行)，必须严格控制：

1. **批量写入**: 累积多个更新后一次性写入
2. **减少更新频率**: trending_score 不需要实时更新
3. **只写变化**: 只有数据真正变化时才写入

### 2.2 利用 R2 做缓存
R2 读取便宜 ($0.36/百万次) 且出口免费：

1. **API 响应缓存**: 把热门列表结果缓存到 R2
2. **Skill 文件缓存**: 避免重复请求 GitHub
3. **预计算结果**: trending/top/recent 列表预先计算

### 2.3 减少 Worker 调用
通过智能缓存减少请求次数：

1. **边缘缓存**: 利用 Cloudflare CDN 缓存静态响应
2. **合并请求**: 批量处理而非逐个请求
3. **懒加载**: 只在必要时才触发后台任务

---

## 三、数据抓取策略 (成本优化版)

### 3.1 极简分层机制

| 层级 | 条件 | 抓取频率 | 预估数量 | 月抓取次数 |
|------|------|----------|----------|-----------|
| Active | 7日内有用户访问 | 每 24 小时 | ~200 | 6,000 |
| Indexed | 其他已入库 | 每 7 天 | ~2,000 | 8,500 |
| Discovery | 新发现 | 入库时一次 | ~500/月 | 500 |

**总计**: ~15,000 次/月 GitHub API 调用，远低于限制

### 3.2 用户驱动的数据更新

**核心思路**: 只有用户关心的 skill 才值得花钱更新

```typescript
// 访问详情页时触发检查
async function onSkillPageVisit(skillId: string, env: Env) {
  const skill = await getSkillFromCache(skillId, env);
  const hoursSinceUpdate = (Date.now() - skill.updatedAt) / 3600000;

  // 超过 24 小时才考虑更新
  if (hoursSinceUpdate > 24) {
    // 标记为需要更新，由定时任务批量处理
    await env.KV.put(`needs_update:${skillId}`, '1', { expirationTtl: 86400 });
  }

  return skill; // 立即返回缓存数据
}
```

### 3.3 批量更新任务 (Cron)

每 6 小时运行一次，批量处理所有标记的 skill：

```typescript
// 每 6 小时执行
async function batchUpdateSkills(env: Env) {
  // 1. 获取所有需要更新的 skill ID
  const needsUpdate = await env.KV.list({ prefix: 'needs_update:' });

  if (needsUpdate.keys.length === 0) return;

  // 2. 限制单次最多更新 100 个 (控制 GitHub API 调用)
  const toUpdate = needsUpdate.keys.slice(0, 100);

  // 3. 批量获取 GitHub 数据
  const updates = await Promise.all(
    toUpdate.map(k => fetchGitHubData(k.name.replace('needs_update:', '')))
  );

  // 4. 单次批量写入 D1 (减少写入次数)
  await batchUpdateD1(updates, env.DB);

  // 5. 清理标记
  await Promise.all(toUpdate.map(k => env.KV.delete(k.name)));
}
```

---

## 四、Trending 指数公式

### 4.1 核心公式

```
TrendingScore = BaseScore × VelocityMultiplier × RecencyBoost × ActivityPenalty
```

### 4.2 因子详解

#### BaseScore (基准分)
```javascript
BaseScore = Math.log10(stars + 1) * 10

// 示例:
// 10 stars   → 10.4 分
// 100 stars  → 20.0 分
// 1000 stars → 30.0 分
```

#### VelocityMultiplier (增速乘数)
```javascript
// 7 天日均增长
const dailyGrowth7d = (starsNow - stars7dAgo) / 7;
// 30 天日均增长
const dailyGrowth30d = (starsNow - stars30dAgo) / 30;
// 加速度
const acceleration = dailyGrowth7d / Math.max(dailyGrowth30d, 0.1);
// 乘数 (1.0 ~ 5.0)
const velocityMultiplier = Math.min(5.0, Math.max(1.0,
  1.0 + Math.log2(dailyGrowth7d + 1) * Math.min(acceleration, 3) * 0.4
));
```

#### RecencyBoost (新鲜度加成)
```javascript
const daysSinceIndexed = (Date.now() - indexedAt) / 86400000;
const recencyBoost = Math.max(1.0, 1.5 - daysSinceIndexed / 14);
// 新入库: 1.5x, 14天后: 1.0x
```

#### ActivityPenalty (活跃度惩罚)
```javascript
const daysSinceCommit = (Date.now() - lastCommitAt) / 86400000;
let activityPenalty = 1.0;
if (daysSinceCommit > 365) activityPenalty = 0.3;
else if (daysSinceCommit > 180) activityPenalty = 0.5;
else if (daysSinceCommit > 90) activityPenalty = 0.7;
else if (daysSinceCommit > 30) activityPenalty = 0.9;
```

### 4.3 计算示例

| 案例 | Stars | 7天增长 | 活跃 | 入库 | 最终分数 |
|------|-------|---------|------|------|----------|
| 新项目爆发 | 50 | +40 | 2天 | 5天 | ~95 |
| 老牌稳定 | 5000 | +10 | 15天 | 200天 | ~57 |
| 停滞项目 | 200 | 0 | 400天 | 300天 | ~7 |

---

## 五、数据存储方案 (成本优化版)

### 5.1 Star 快照压缩存储

为了减少存储和写入成本，只保留关键数据点：

```typescript
interface StarSnapshot {
  d: string;  // YYYY-MM-DD
  s: number;  // star count
}

// 压缩规则: 最多保留 20 个点
// - 入库时
// - 每周一个点 (最近 8 周)
// - 每月一个点 (更早)
// - 显著变化点 (单日增长 > 10%)
```

### 5.2 预计算列表 (R2 缓存)

把热门列表预计算后存储到 R2，避免每次查询都读 D1：

```
r2://skillscat/
├── cache/
│   ├── trending.json      # Trending 列表 (每 6 小时更新)
│   ├── recent.json        # Recent 列表 (每小时更新)
│   ├── top.json           # Top 列表 (每天更新)
│   └── categories/
│       ├── coding.json
│       └── ...
└── skills/
    └── {author}/{skill}/  # Skill 文件缓存
```

### 5.3 KV 用于临时状态

使用 Workers KV (免费 100K 读/天) 存储临时状态：

- `needs_update:{skillId}` - 需要更新的标记
- `rate_limit:{ip}` - Rate limiting
- `session:{token}` - 用户会话

---

## 六、成本预估

### 6.1 假设场景
- 总 skills: 5,000
- 日活跃访问: 1,000 PV
- 月新增 skills: 200

### 6.2 月度成本

| 服务 | 用量 | 费用 |
|------|------|------|
| Workers 基础 | - | $5.00 |
| Workers 请求 | ~100K | 包含 |
| D1 读取 | ~500K 行 | 包含 |
| D1 写入 | ~50K 行 | 包含 |
| R2 存储 | ~1GB | $0.02 |
| R2 读取 | ~100K | 包含 |
| Queues | ~10K 消息 | 包含 |
| **总计** | | **~$5-6/月** |

### 6.3 规模扩展预估

| Skills 数量 | 月 PV | 预估月费 |
|-------------|-------|----------|
| 5,000 | 10,000 | ~$6 |
| 20,000 | 50,000 | ~$10 |
| 100,000 | 200,000 | ~$25 |

---

## 七、Trending 更新流程

### 7.1 定时任务 (Cron)

```
┌─────────────────────────────────────────────────────────┐
│ 每 6 小时: trending-updater                              │
├─────────────────────────────────────────────────────────┤
│ 1. 读取 KV 中 needs_update:* 标记                        │
│ 2. 批量调用 GitHub API 获取最新数据                       │
│ 3. 计算 trending_score                                  │
│ 4. 使用 db.batch() 原子写入 D1 (最多 100 条)              │
│ 5. 重新生成 R2 缓存文件                                  │
│ 6. 清理 KV 标记                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.2 访问触发流程

```
用户访问 /skill/:author/:name
         │
         ▼
    读取 R2 缓存
         │
    ┌────┴────┐
    │ 有缓存? │
    └────┬────┘
      是 │  否
         │    └──► 读取 D1 ──► 写入 R2 缓存
         │
         ▼
    检查数据新鲜度
         │
    ┌────┴────────┐
    │ 超过 24 小时? │
    └────┬────────┘
      是 │  否
         │    └──► 直接返回
         │
         ▼
    写入 KV 标记 (needs_update)
         │
         ▼
    返回缓存数据 (不阻塞)
```

---

## 八、实现代码

### 8.1 Trending 计算

```typescript
export function calculateTrendingScore(skill: {
  stars: number;
  starSnapshots: Array<{ d: string; s: number }>;
  indexedAt: number;
  lastCommitAt: number;
}): number {
  const now = Date.now();

  // BaseScore
  const baseScore = Math.log10(skill.stars + 1) * 10;

  // VelocityMultiplier
  const stars7dAgo = getStarsAtDaysAgo(skill.starSnapshots, 7, skill.stars);
  const stars30dAgo = getStarsAtDaysAgo(skill.starSnapshots, 30, skill.stars);

  const dailyGrowth7d = Math.max(0, (skill.stars - stars7dAgo) / 7);
  const dailyGrowth30d = Math.max(0, (skill.stars - stars30dAgo) / 30);

  const acceleration = dailyGrowth30d > 0.1
    ? dailyGrowth7d / dailyGrowth30d
    : dailyGrowth7d > 0 ? 2 : 1;

  const velocityMultiplier = Math.min(5.0, Math.max(1.0,
    1.0 + Math.log2(dailyGrowth7d + 1) * Math.min(acceleration, 3) * 0.4
  ));

  // RecencyBoost
  const daysSinceIndexed = (now - skill.indexedAt) / 86400000;
  const recencyBoost = Math.max(1.0, 1.5 - daysSinceIndexed / 14);

  // ActivityPenalty
  const daysSinceCommit = (now - skill.lastCommitAt) / 86400000;
  let activityPenalty = 1.0;
  if (daysSinceCommit > 365) activityPenalty = 0.3;
  else if (daysSinceCommit > 180) activityPenalty = 0.5;
  else if (daysSinceCommit > 90) activityPenalty = 0.7;
  else if (daysSinceCommit > 30) activityPenalty = 0.9;

  return Math.round(baseScore * velocityMultiplier * recencyBoost * activityPenalty * 100) / 100;
}

function getStarsAtDaysAgo(
  snapshots: Array<{ d: string; s: number }>,
  daysAgo: number,
  currentStars: number
): number {
  if (!snapshots || snapshots.length === 0) return currentStars;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysAgo);
  const target = targetDate.toISOString().split('T')[0];

  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].d <= target) {
      return snapshots[i].s;
    }
  }

  return snapshots[0]?.s ?? currentStars;
}
```

### 8.2 批量更新 Worker

```typescript
// workers/trending-updater/src/index.ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // 1. 获取需要更新的 skills (从 KV)
    const list = await env.KV.list({ prefix: 'needs_update:', limit: 100 });

    if (list.keys.length === 0) {
      // 没有标记的，更新 top 100 活跃 skills
      await updateTopActiveSkills(env);
      return;
    }

    const skillIds = list.keys.map(k => k.name.replace('needs_update:', ''));

    // 2. 从 D1 获取基础信息
    const skills = await env.DB.prepare(`
      SELECT id, github_url, stars, star_snapshots, indexed_at, last_commit_at
      FROM skills WHERE id IN (${skillIds.map(() => '?').join(',')})
    `).bind(...skillIds).all();

    // 3. 批量获取 GitHub 数据 (使用 Promise.all 但限制并发)
    const updates: Array<{ id: string; stars: number; score: number }> = [];

    for (const skill of skills.results) {
      try {
        const ghData = await fetchGitHubRepo(skill.github_url, env.GITHUB_TOKEN);

        // 只有 stars 变化才更新
        if (ghData.stars !== skill.stars) {
          const snapshots = JSON.parse(skill.star_snapshots || '[]');
          snapshots.push({ d: new Date().toISOString().split('T')[0], s: ghData.stars });

          // 压缩快照 (保留最近 20 个)
          const compressed = compressSnapshots(snapshots);

          const score = calculateTrendingScore({
            stars: ghData.stars,
            starSnapshots: compressed,
            indexedAt: skill.indexed_at,
            lastCommitAt: ghData.pushedAt
          });

          updates.push({
            id: skill.id,
            stars: ghData.stars,
            starSnapshots: JSON.stringify(compressed),
            lastCommitAt: ghData.pushedAt,
            score
          });
        }
      } catch (e) {
        console.error(`Failed to update ${skill.id}:`, e);
      }
    }

    // 4. 批量写入 D1 (使用 batch 原子操作)
    // 注意: D1 不支持传统事务，但 batch() 是原子的，全部成功或全部失败
    if (updates.length > 0) {
      const statements = updates.map(u =>
        env.DB.prepare(`
          UPDATE skills
          SET stars = ?, star_snapshots = ?, last_commit_at = ?, trending_score = ?, updated_at = ?
          WHERE id = ?
        `).bind(u.stars, u.starSnapshots, u.lastCommitAt, u.score, Date.now(), u.id)
      );
      // batch 最多支持 100 条语句
      await env.DB.batch(statements);
    }

    // 5. 重新生成缓存
    await regenerateListCaches(env);

    // 6. 清理 KV 标记
    await Promise.all(list.keys.map(k => env.KV.delete(k.name)));
  }
};

function compressSnapshots(snapshots: Array<{ d: string; s: number }>): Array<{ d: string; s: number }> {
  if (snapshots.length <= 20) return snapshots;

  // 保留: 最早、最新、每周一个、显著变化点
  const result: Array<{ d: string; s: number }> = [];
  const now = new Date();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const date = new Date(snap.d);
    const daysAgo = (now.getTime() - date.getTime()) / 86400000;

    // 保留规则
    const isFirst = i === 0;
    const isLast = i === snapshots.length - 1;
    const isRecent = daysAgo <= 7; // 最近 7 天
    const isWeekly = daysAgo <= 56 && date.getDay() === 0; // 8 周内的周日
    const isMonthly = daysAgo > 56 && date.getDate() === 1; // 更早的月初

    // 显著变化 (> 10%)
    const prev = snapshots[i - 1];
    const isSignificant = prev && prev.s > 0 && Math.abs(snap.s - prev.s) / prev.s > 0.1;

    if (isFirst || isLast || isRecent || isWeekly || isMonthly || isSignificant) {
      result.push(snap);
    }
  }

  return result.slice(-20); // 最多保留 20 个
}
```

### 8.3 缓存重新生成

```typescript
async function regenerateListCaches(env: Env) {
  // Trending 列表
  const trending = await env.DB.prepare(`
    SELECT id, name, slug, description, repo_owner, stars, trending_score, updated_at
    FROM skills
    ORDER BY trending_score DESC
    LIMIT 100
  `).all();

  await env.R2.put('cache/trending.json', JSON.stringify({
    data: trending.results,
    generatedAt: Date.now()
  }), {
    httpMetadata: { contentType: 'application/json' }
  });

  // Top 列表
  const top = await env.DB.prepare(`
    SELECT id, name, slug, description, repo_owner, stars, trending_score, updated_at
    FROM skills
    ORDER BY stars DESC
    LIMIT 100
  `).all();

  await env.R2.put('cache/top.json', JSON.stringify({
    data: top.results,
    generatedAt: Date.now()
  }), {
    httpMetadata: { contentType: 'application/json' }
  });

  // Recent 列表
  const recent = await env.DB.prepare(`
    SELECT id, name, slug, description, repo_owner, stars, trending_score, updated_at
    FROM skills
    ORDER BY indexed_at DESC
    LIMIT 100
  `).all();

  await env.R2.put('cache/recent.json', JSON.stringify({
    data: recent.results,
    generatedAt: Date.now()
  }), {
    httpMetadata: { contentType: 'application/json' }
  });
}
```

---

## 九、监控指标

### 9.1 成本监控

- D1 每日写入行数
- R2 每日 Class A 操作数
- GitHub API 剩余配额
- Queue 消息数量

### 9.2 告警规则

```yaml
alerts:
  - name: d1_write_spike
    condition: d1_writes_per_day > 100000
    action: notify

  - name: github_rate_limit_low
    condition: github_remaining < 1000
    action: pause_updates

  - name: cache_stale
    condition: cache_age > 12h
    action: force_regenerate
```

---

## 参考资料

- [Cloudflare D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [GitHub API Rate Limits](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting)
