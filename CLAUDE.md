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
- **Monorepo**: Turborepo + pnpm

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
│       └── static/                 # 静态资源
├── workers/
│   ├── github-events/              # GitHub 事件轮询 (Cron)
│   ├── indexing/                   # 入库处理 (Queue Consumer)
│   ├── classification/             # AI 分类 (Queue Consumer)
│   └── trending/                   # Trending 计算 (Cron)
├── scripts/
│   └── dev-workers.mjs             # 多 Worker 开发脚本
├── wrangler.web.toml.example       # Web Worker 配置示例
├── wrangler.github-events.toml.example
├── wrangler.indexing.toml.example
├── wrangler.classification.toml.example
├── wrangler.trending.toml.example
├── turbo.json
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
```

## 常用命令

```bash
# 项目初始化 (首次运行)
pnpm init:project       # 交互式初始化，创建配置文件和 Cloudflare 资源
pnpm init:local         # 仅本地配置，不创建 Cloudflare 资源

# 安装依赖
pnpm install

# 开发模式 (仅 Web)
pnpm dev

# 开发模式 (Web + Workers)
pnpm dev:all

# 开发模式 (仅 Workers)
pnpm dev:workers

# 构建
pnpm build

# 类型检查
pnpm typecheck

# 部署
pnpm deploy
```

## 快速开始

```bash
# 1. 克隆项目后，运行初始化脚本
pnpm init:project

# 2. 脚本会自动:
#    - 复制 wrangler.*.toml.example 到 wrangler.*.toml
#    - 生成随机 secrets (BETTER_AUTH_SECRET, WORKER_SECRET)
#    - 创建 .dev.vars 文件
#    - (可选) 创建 Cloudflare 资源 (D1, R2, KV, Queues)
#    - (可选) 更新 wrangler.toml 中的资源 ID

# 3. 启动开发服务器
pnpm dev
```

## Wrangler 配置

项目使用多个 wrangler 配置文件，每个 Worker 一个。

**推荐**: 使用 `pnpm init:project` 自动配置。

**手动配置**:
```bash
# 复制示例配置
cp wrangler.web.toml.example wrangler.web.toml
cp wrangler.github-events.toml.example wrangler.github-events.toml
cp wrangler.indexing.toml.example wrangler.indexing.toml
cp wrangler.classification.toml.example wrangler.classification.toml
cp wrangler.trending.toml.example wrangler.trending.toml

# 编辑配置，填入你的 database_id, kv_id 等
```

**注意**: `wrangler.*.toml` 文件已被 gitignore，只有 `.example` 文件会被提交。

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

创建 `.dev.vars` 文件 (不提交):

```
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_TOKEN=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
OPENROUTER_API_KEY=xxx
DEEPSEEK_API_KEY=xxx
BETTER_AUTH_SECRET=xxx
WORKER_SECRET=xxx
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
- [UI 设计指南](.claude/ui-design-guide.md)
- [SvelteKit 文档](https://kit.svelte.dev)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers)
