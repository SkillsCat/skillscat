# CLAUDE.md - SkillsCat 开发指引

## 项目概述

SkillsCat 是一个 Claude Code Skills 收集与分享平台，基于 SvelteKit 构建，部署在 Cloudflare Workers 上。

## 技术栈

- **框架**: SvelteKit 2.x + Svelte 5
- **UI**: Bits UI + Radix Svelte
- **样式**: UnoCSS (Tailwind preset)
- **构建**: Vite + Wrangler
- **部署**: Cloudflare Workers
- **数据库**: Cloudflare D1 + Drizzle ORM
- **存储**: Cloudflare R2
- **队列**: Cloudflare Queues
- **认证**: Better Auth (GitHub OAuth)

## 项目结构

```
skillscat/
├── apps/
│   └── web/                        # @skillscat/web - SvelteKit 主站
│       ├── src/
│       │   ├── lib/
│       │   │   ├── components/     # UI 组件
│       │   │   ├── constants/      # 常量 (categories 等)
│       │   │   ├── server/         # 服务端代码
│       │   │   │   └── db/         # Drizzle schema
│       │   │   ├── types.ts        # 共享类型
│       │   │   └── utils/          # 工具函数
│       │   ├── routes/             # 页面路由
│       │   └── app.css             # 全局样式
│       ├── workers/                # Cloudflare Workers (独立 TS 文件)
│       │   ├── github-events.ts    # GitHub 事件轮询 (Cron)
│       │   ├── indexing.ts         # 入库处理 (Queue Consumer)
│       │   ├── classification.ts   # AI 分类 (Queue Consumer)
│       │   ├── trending.ts         # Trending 计算 (Cron)
│       │   ├── tier-recalc.ts      # Tier 重算 (Cron daily)
│       │   ├── archive.ts          # 归档冷数据 (Cron monthly)
│       │   ├── resurrection.ts     # 复活归档 (Cron quarterly)
│       │   ├── types.ts            # Workers 共享类型
│       │   ├── categories.ts       # 分类定义
│       │   └── utils.ts            # 工具函数
│       ├── scripts/
│       │   └── preview.mjs         # Preview 启动脚本
│       ├── static/                 # 静态资源
│       ├── wrangler.preview.toml   # Web 主站配置
│       ├── wrangler.github-events.toml
│       ├── wrangler.indexing.toml
│       ├── wrangler.classification.toml
│       ├── wrangler.trending.toml
│       ├── wrangler.tier-recalc.toml
│       ├── wrangler.archive.toml
│       └── wrangler.resurrection.toml
├── scripts/
│   └── init.mjs                    # 环境初始化脚本 (本地/生产)
├── pnpm-workspace.yaml
└── CLAUDE.md
```

## Workers 架构

```
GitHub Events API
       │
       ▼ (Cron: 每 5 分钟)
┌──────────────────┐
│  github-events   │ ──► 发现新的 SKILL.md
└──────────────────┘
       │
       ▼ (Queue: skillscat-indexing)
┌──────────────────┐
│    indexing      │ ──► 获取仓库信息，入库 D1，缓存 R2
└──────────────────┘
       │
       ▼ (Queue: skillscat-classification)
┌──────────────────┐
│  classification  │ ──► AI 分类，更新 skill_categories
└──────────────────┘

┌──────────────────┐
│    trending      │ ──► 计算 trending score (Cron: 每小时)
└──────────────────┘

┌──────────────────┐
│   tier-recalc    │ ──► 重算 tier，重置访问计数 (Cron: 每天)
└──────────────────┘

┌──────────────────┐
│     archive      │ ──► 归档冷数据到 R2 (Cron: 每月)
└──────────────────┘

┌──────────────────┐
│  resurrection    │ ──► 复活归档 skills (Cron: 每季度)
└──────────────────┘
```

## 常用命令

```bash
# 项目初始化 (首次运行)
pnpm init:project       # 本地开发环境初始化，创建配置文件
pnpm init:local         # 仅本地配置，不创建 Cloudflare 资源
pnpm init:production    # 线上环境初始化，创建 Cloudflare 资源并配置 secrets

# 安装依赖
pnpm install

# 开发模式 (仅 SvelteKit，热重载)
pnpm dev
pnpm dev:web            # 同上

# 预览模式 (完整项目，包含所有 Workers)
pnpm preview:web        # 启动 Web + 所有 Workers

# 构建
pnpm build

# 类型检查
pnpm typecheck

# 部署
pnpm deploy
```

## 快速开始

```bash
# 1. 克隆项目后，运行本地开发环境初始化脚本
pnpm init:project

# 2. 脚本会自动:
#    - 生成随机 secrets (BETTER_AUTH_SECRET, WORKER_SECRET)
#    - 创建 apps/web/.dev.vars 文件
#    - 复制 wrangler.*.toml.example 到 wrangler.*.toml (使用 local 配置)
#    - (可选) 创建 Cloudflare 资源 (D1, R2, KV, Queues)

# 3. 启动开发服务器
pnpm dev                # 仅 SvelteKit (推荐日常开发)
pnpm preview:web        # 完整预览 (包含 Workers)

# 4. 线上环境部署
pnpm init:production    # 创建 Cloudflare 资源并配置 secrets
pnpm deploy             # 部署所有 Workers
```

## Wrangler 配置

所有 wrangler 配置文件位于 `apps/web/` 目录下：

- `wrangler.preview.toml` - Web 主站配置
- `wrangler.github-events.toml` - GitHub 事件轮询 Worker
- `wrangler.indexing.toml` - 入库处理 Worker
- `wrangler.classification.toml` - AI 分类 Worker
- `wrangler.trending.toml` - Trending 计算 Worker
- `wrangler.tier-recalc.toml` - Tier 重算 Worker
- `wrangler.archive.toml` - 归档 Worker
- `wrangler.resurrection.toml` - 复活 Worker

Preview 模式会合并所有配置文件启动完整项目。

## 开发规范

### 代码风格

- 使用 TypeScript 严格模式
- 组件使用 PascalCase 命名
- 工具函数使用 camelCase 命名
- 常量使用 UPPER_SNAKE_CASE

### 组件开发

```svelte
<script lang="ts">
  import { type ComponentProps } from '$lib/types';

  let { prop1, prop2 = 'default' }: ComponentProps = $props();
</script>

<div class="component-class">
  <!-- 内容 -->
</div>
```

### 样式规范

- 使用 UnoCSS 原子类
- 自定义样式使用 CSS 变量
- 遵循移动优先响应式设计

### Button 组件使用

Button 组件位于 `$lib/components/ui/Button.svelte`，支持以下属性：

```svelte
<Button
  variant="cute"      // 'primary' | 'secondary' | 'ghost' | 'outline' | 'cute'
  size="md"           // 'sm' | 'md' | 'lg'
  href="/path"        // 可选，有 href 时渲染为 <a> 标签
  onclick={handler}   // 可选，点击事件
  disabled={false}    // 可选，禁用状态
>
  Button Text
</Button>
```

**Variant 说明：**

| Variant | 效果 | 使用场景 |
|---------|------|----------|
| `cute` | 3D 底部阴影，按下时下沉 | **主要 CTA 按钮**（推荐） |
| `primary` | 对角阴影，悬停时浮起 | 次要强调按钮 |
| `outline` | 边框 + 对角阴影 | 次要操作按钮 |
| `secondary` | 浅色背景，微弱阴影 | 辅助操作 |
| `ghost` | 透明背景 | 导航链接、图标按钮 |

**推荐组合：**

```svelte
<!-- 主要操作 + 次要操作 -->
<Button variant="cute" href="/">Go Home</Button>
<Button variant="outline" onclick={goBack}>Go Back</Button>

<!-- 导航栏提交按钮 -->
<Button variant="cute" size="sm" onclick={submit}>
  <Icon /> Submit
</Button>
```

### Cute Style 设计原则

SkillsCat 使用 "Cute Style" 设计语言，核心特征是 3D 底部阴影效果。

**核心特征：**

| 特征 | 说明 |
|------|------|
| 3D 底部阴影 | `box-shadow: 0 4px 0 0 [color]` - 纯底部偏移 |
| 粗边框 | 2-3px 边框，增强视觉层次 |
| 圆角 | 按钮使用 `border-radius: 9999px`，输入框使用 `1.25rem` |
| 交互动画 | 悬停上浮 (-2px)，点击下沉 (+3px) |

**阴影状态变化：**

| 状态 | 阴影偏移 | 元素位移 |
|------|----------|----------|
| 默认 | 4px | 0 |
| 悬停 | 6px | -2px (上浮) |
| 点击 | 1px | +3px (下沉) |

**阴影颜色：**
- 主色调: `oklch(50% 0.22 55)` (橙色)
- 中性色: `oklch(75% 0.02 85)` (灰色)
- 成功色: `oklch(55% 0.18 145)` (绿色)
- 危险色: `oklch(45% 0.20 25)` (红色)

**应用场景：**
- 按钮: 使用 `variant="cute"` 或 `variant="cute-secondary"`
- 输入框: 添加底部阴影，聚焦时下沉
- 卡片: 悬停时上浮，阴影扩展
- 标签: 添加边框和小阴影

**示例 - Cute 输入框：**
```css
input {
  border: 2px solid var(--border);
  box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
}

input:focus {
  border-color: var(--primary);
  box-shadow: 0 1px 0 0 var(--primary);
  transform: translateY(2px);
}
```

**示例 - Cute 卡片：**
```css
.card {
  border: 2px solid var(--border);
  box-shadow: 0 4px 0 0 var(--border);
}

.card:hover {
  border-color: var(--primary);
  box-shadow: 0 6px 0 0 var(--primary);
  transform: translateY(-2px);
}
```

## 环境变量

在 `apps/web/` 目录下创建 `.dev.vars` 文件 (不提交)，或运行 `pnpm init:project` 自动生成:

```
# 自动生成的 secrets
BETTER_AUTH_SECRET=xxx
WORKER_SECRET=xxx

# GitHub OAuth (必需)
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_TOKEN=xxx

# OpenRouter API (用于 AI 分类)
OPENROUTER_API_KEY=xxx
AI_MODEL=liquid/lfm-2.5-1.2b-thinking:free

# 可选: 免费模型池 (用于 fallback)
# FREE_MODELS=liquid/lfm-2.5-1.2b-thinking:free,google/gemma-3-1b-it:free

# DeepSeek API (兜底策略，可选)
DEEPSEEK_API_KEY=xxx
```

### AI 分类 Fallback 策略

Classification Worker 使用多层 fallback 策略确保分类成功率:

1. 使用 AI_MODEL 指定的主模型调用 OpenRouter
2. 失败后在同一模型上重试一次
3. 从 FREE_MODELS 模型池中随机选择另一个模型重试
4. 使用 DeepSeek 官方 API (deepseek-chat) 作为兜底
5. 最终降级到关键词分类

注意: 所有模型配置都通过环境变量指定，代码中不包含默认模型列表。

## 数据库操作

```bash
# 生成 migration
pnpm db:generate

# 执行 migration
pnpm db:migrate

# 本地开发数据库
pnpm db:local
```

## 部署检查清单

- [ ] 环境变量已配置
- [ ] D1 数据库已创建
- [ ] R2 bucket 已创建
- [ ] Queues 已配置 (skillscat-indexing, skillscat-classification)
- [ ] KV Namespace 已创建
- [ ] OAuth 回调 URL 已更新
- [ ] 所有 wrangler.*.toml 已配置

## 相关文档

- [详细需求文档](.claude/requirements.md)
- [开发计划](.claude/development-plan.md)
- [Trending 算法](.claude/trending-algorithm.md)
- [Workers 架构](.claude/workers-architecture.md)
- [UI 设计指南](.claude/ui-design-guide.md)
- [SvelteKit 文档](https://kit.svelte.dev)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers)
