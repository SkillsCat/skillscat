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
- **认证**: Better Auth (GitHub + Google OAuth)

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
│   ├── init.mjs                    # 本地开发环境初始化脚本
│   └── init-production.mjs         # 线上环境初始化脚本
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

# OpenRouter API (可选，用于 AI 分类)
# 只使用免费模型，无需付费
OPENROUTER_API_KEY=xxx
```

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
