# AGENTS.md

## 项目定位

SkillsCat 是一个 `pnpm` monorepo，目标是构建一个用于发现、发布、安装 AI agent skills 的平台。

- `apps/web` 是主站和 API，运行在 Cloudflare Workers 上。
- `apps/cli` 是 `skillscat` CLI，用于搜索、安装、发布、更新 skills。
- `scripts` 放初始化、部署、发布、资源同步脚本。

以当前代码和配置为准，不要盲信旧文档：

- 根目录 `README.md` 提到了 Turborepo，但仓库当前没有 `turbo` 配置，真实工作区由 `pnpm-workspace.yaml` 和各应用 `package.json` 驱动。
- [apps/web/README.md](/Users/orchiliao/Projects/skillscat/apps/web/README.md) 仍是默认 Svelte 模板，不是这个项目的真实说明。

## Monorepo 结构

- [apps/web](/Users/orchiliao/Projects/skillscat/apps/web): SvelteKit 站点、SSR、API、Cloudflare Worker 配置、D1 migrations、后台 workers。
- [apps/cli](/Users/orchiliao/Projects/skillscat/apps/cli): Commander CLI，支持 add/search/publish/login/update 等命令。
- [scripts](/Users/orchiliao/Projects/skillscat/scripts): 项目初始化、Web 发布、CLI 发布、Workers 部署、Cloudflare secrets/资源管理。
- [apps/web/src/lib/server/db/schema.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/db/schema.ts): D1/Drizzle schema source of truth。
- [apps/web/migrations](/Users/orchiliao/Projects/skillscat/apps/web/migrations): Drizzle 生成的 migration 和 meta snapshots。

## 实际技术栈

### Web

- SvelteKit 2
- Svelte 5
- `@sveltejs/adapter-cloudflare`
- TypeScript
- UnoCSS
- Better Auth
- Drizzle ORM + Cloudflare D1
- Vitest

### CLI

- Commander
- Rollup
- TypeScript
- Vitest

### Cloudflare 基础设施

项目是 Cloudflare-first，不是普通 Node Web 应用。当前代码实际使用了：

- Cloudflare Workers
- D1
- R2
- KV
- Queues
- Cache API

关键绑定定义可参考：

- [apps/web/src/app.d.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/app.d.ts)
- [apps/web/wrangler.preview.toml.example](/Users/orchiliao/Projects/skillscat/apps/web/wrangler.preview.toml.example)
- [apps/web/.dev.vars.example](/Users/orchiliao/Projects/skillscat/apps/web/.dev.vars.example)

## 业务能力概览

### Web / API

`apps/web` 当前覆盖的核心能力包括：

- 公共页面：首页、trending、top、recent、categories、category、search、skill 详情、用户页、组织页、bookmarks、device flow、隐私/条款、OG、sitemap。
- Registry / tool API：供 CLI 和外部 agent/tooling 调用的搜索、repo 解析、skill 文件读取接口。
- 用户与组织能力：账号、tokens、organizations、members、skills、notifications。
- 技能发布与管理：上传、预览、可见性调整、下载、文件读取、分享、推荐、安装追踪。
- 鉴权与安全：GitHub OAuth、device auth、registry auth、request security、CORS/CSRF/UA 保护、rate limit。

### 业务角色边界

- 项目没有“管理员”这个业务角色，所有能力都只面向普通用户、组织所有者或组织成员设计。
- 不要新增 `admin`、`superadmin`、后台运营专用接口、隐藏管理入口或仅供人工操作的管理路由。
- 如果需要批处理、归档、恢复、重算、同步之类的内部能力，应优先落在 worker、queue、cron 或现有普通用户触发链路里，而不是暴露成 `admin API`。
- 设计权限模型时，只能基于现有真实主体做约束：未登录用户、登录用户、skill owner、organization member、organization owner，以及显式分享授权对象。

### CLI

`apps/cli` 当前覆盖：

- 安装/卸载 skills
- 搜索 registry
- 读取 repo 并发现多 skill 仓库
- 登录/登出/whoami
- 发布与下架 private skill
- 更新已安装 skill 和 CLI 自身
- 本地安装记录与缓存

本地 CLI 数据位置由 [apps/cli/src/utils/config/config.ts](/Users/orchiliao/Projects/skillscat/apps/cli/src/utils/config/config.ts) 管理，安装记录在 `installed.json`，缓存位于 OS 用户配置目录下。

## Cloudflare 资源与后台 Worker

当前项目有一组独立的 Cloudflare workers / cron / queue 消费者：

- `github-events`: 轮询 GitHub Events 和 Code Search，发现包含 `SKILL.md` 的仓库。
- `indexing`: 拉取 GitHub 仓库内容，写入 D1，并缓存 `SKILL.md`/文本文件到 R2，再投递分类任务。
- `classification`: 用 AI 或关键词分类 skills，写分类结果，并标记 search/recommend 预计算状态。
- `trending`: 刷新 star/download/access 指标、更新 trending score、维护列表缓存。
- `search-precompute`: 预计算搜索分数和推荐结果，降低请求时计算成本。
- `tier-recalc`: 按访问和 star 情况重算 hot/warm/cool/cold/archived tier。
- `archive`: 归档长期冷数据到 R2，减少存储与查询成本。
- `resurrection`: 在仓库重新活跃时恢复已归档 skills。

资源命名与初始化逻辑主要在 [scripts/init.mjs](/Users/orchiliao/Projects/skillscat/scripts/init.mjs)。

默认会管理的核心资源包括：

- D1: `skillscat-db`
- R2: `skillscat-storage`
- KV: `skillscat-kv`
- Queues: `skillscat-indexing`, `skillscat-classification` 及对应 DLQ

## 关键代码入口

- 路由与 SSR 入口: [apps/web/src/hooks.server.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/hooks.server.ts)
- D1 schema: [apps/web/src/lib/server/db/schema.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/db/schema.ts)
- 缓存封装: [apps/web/src/lib/server/cache.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/cache.ts)
- 页面缓存头: [apps/web/src/lib/server/page-cache.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/page-cache.ts)
- 请求安全/速率限制: [apps/web/src/lib/server/request-security.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/request-security.ts)
- Auth: [apps/web/src/lib/server/auth.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/auth.ts)
- Registry search: [apps/web/src/lib/server/registry-search.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/registry-search.ts)
- Registry repo resolve: [apps/web/src/lib/server/registry-repo.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/registry-repo.ts)
- DB 工具与列表读取: [apps/web/src/lib/server/db/utils.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/db/utils.ts)
- Service worker 缓存策略: [apps/web/src/service-worker/cache-strategies.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/service-worker/cache-strategies.ts)
- CLI 入口: [apps/cli/src/index.ts](/Users/orchiliao/Projects/skillscat/apps/cli/src/index.ts)
- CLI registry API: [apps/cli/src/utils/api/registry.ts](/Users/orchiliao/Projects/skillscat/apps/cli/src/utils/api/registry.ts)
- CLI 安装记录: [apps/cli/src/utils/storage/db.ts](/Users/orchiliao/Projects/skillscat/apps/cli/src/utils/storage/db.ts)
- CLI 本地缓存: [apps/cli/src/utils/storage/cache.ts](/Users/orchiliao/Projects/skillscat/apps/cli/src/utils/storage/cache.ts)

## 常用命令

### 根目录

```bash
pnpm install
pnpm init:project
pnpm init:local
pnpm init:production
pnpm dev:web
pnpm preview:web
pnpm preview:web:prod
pnpm build
pnpm build:cli
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm db:generate
pnpm db:migrate
pnpm db:migrate:prod
pnpm test:cli
pnpm deploy
pnpm deploy:workers
pnpm publish:cli
```

### Web 子应用

```bash
pnpm --filter @skillscat/web dev
pnpm --filter @skillscat/web build
pnpm --filter @skillscat/web preview
pnpm --filter @skillscat/web test
pnpm --filter @skillscat/web typecheck
pnpm --filter @skillscat/web db:generate
pnpm --filter @skillscat/web db:migrate
```

### CLI 子应用

```bash
pnpm --filter ./apps/cli build
pnpm --filter ./apps/cli test
pnpm --filter ./apps/cli typecheck
```

## 开发规范

### 1. Migration 规范

- `apps/web/migrations` 下的 migration 必须通过 Drizzle 生成，不允许手写 SQL migration。
- 正确流程是先改 [apps/web/src/lib/server/db/schema.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/db/schema.ts)，再运行 `pnpm db:generate` 或 `pnpm --filter @skillscat/web db:generate`。
- migration 生成后要检查 `migrations/meta` 是否同步更新。
- schema、migration、运行时代码必须保持一致。

### 2. Cloudflare-first 规范

- `apps/web` 和 `apps/web/workers` 的代码必须优先按 Cloudflare Workers 运行时设计，不要默认按 Node 服务端思维写代码。
- 只要是 Web/Worker 路径，优先使用 Cloudflare 原生能力和 bindings。
- 如新增 binding、secret、worker、cron 或 queue，必须同步检查这些位置：
  - [apps/web/src/app.d.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/app.d.ts)
  - `wrangler.*.toml.example`
  - [scripts/init.mjs](/Users/orchiliao/Projects/skillscat/scripts/init.mjs)
  - [scripts/deploy-workers.mjs](/Users/orchiliao/Projects/skillscat/scripts/deploy-workers.mjs)
  - 相关 worker 入口和文档

### 3. 缓存与性能规范

- 项目使用的是全套 Cloudflare 技术栈，所有 Web / Worker 改动都必须优先考虑性能和成本。
- 缓存优先使用 Cloudflare Cache API，不要先想到自建 KV 缓存。
- Web 侧已有统一缓存封装，优先复用：
  - [apps/web/src/lib/server/cache.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/cache.ts)
  - [apps/web/src/lib/server/page-cache.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/page-cache.ts)
  - [apps/web/src/service-worker/cache-strategies.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/service-worker/cache-strategies.ts)
- 公共接口要明确设置 `Cache-Control`，并尽量补充 `X-Cache` 语义。
- 私有数据、鉴权数据、带用户态的数据，不能进入共享缓存。
- 可以异步写缓存时，优先走 `waitUntil`，不要把缓存写入阻塞在主请求路径上。
- 能走 R2 / Cache API / 预计算结果的，就不要重复打 GitHub API 或 D1。

### 4. SQL / D1 成本控制规范

- 任何涉及 SQL 查询的改动，都必须明确考虑 row read 成本，避免 D1 成本放大。
- 查询只取需要的列，禁止无意义 `SELECT *`。
- 必须优先使用 `WHERE`、`LIMIT`、分页、索引列排序，避免全表扫描。
- 避免 N+1 查询；能批量取就批量取。
- 对高频列表接口，优先采用“先查 ID，再 hydrate 明细”的模式，减少扫描和传输。
- 如果引入新的筛选/排序路径，需要同步评估 [apps/web/src/lib/server/db/schema.ts](/Users/orchiliao/Projects/skillscat/apps/web/src/lib/server/db/schema.ts) 是否需要新增索引。
- 对会频繁执行的聚合、推荐、搜索、统计逻辑，优先放到 worker/预计算链路，不要堆到同步请求路径。

### 5. 缓存失效规范

- 任何会修改 skills、categories、visibility、推荐结果、列表结果的接口，都要同步考虑缓存失效。
- 除了 Cache API，也要检查是否需要同步删除或刷新 R2 中的衍生对象。
- 新增公共缓存 key 时，使用稳定的版本前缀，避免 deploy 后脏缓存污染。

### 6. 鉴权与安全规范

- 保持 Better Auth + GitHub OAuth 的现有集成方式，不要绕过已有 session/auth 封装。
- `/api/*` 默认应为 `no-store`，除非该接口明确设计为公共可缓存接口。
- 不要破坏已有的 request security、UA 校验、CORS、CSRF、rate limit 逻辑。
- 改动工具接口或 registry 接口时，注意 CLI、外部 agent、crawler 的兼容性。
- 不要引入“管理员专用”鉴权分支、`/api/admin/*` 路由或等价的隐藏管理接口；内部操作应走 worker bindings、queue、cron 或用户态已存在流程。

### 7. 代码风格规范

- 全仓库使用 TypeScript。
- ESLint 当前重点约束：
  - 禁止遗留未使用 imports
  - 禁止随意使用 `any`
- Svelte、TS、JS、mjs 都已接入统一 lint 配置，配置见 [eslint.config.js](/Users/orchiliao/Projects/skillscat/eslint.config.js)。

## 变更前后检查清单

做任何中大型改动前后，至少检查：

1. 影响的是 `apps/web`、`apps/cli`，还是 Cloudflare worker。
2. 是否会影响 D1 schema / migration / bindings / secrets。
3. 是否需要缓存、缓存失效、或改成预计算。
4. 是否会增加 D1 row reads、GitHub API 请求数、R2 读写次数、Queue 积压。
5. 是否需要补索引、分页、限制返回列。
6. 是否需要同步更新测试、初始化脚本、wrangler 示例配置。

## 测试建议

常见改动完成后，优先跑和改动最相关的检查：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @skillscat/web test`
- `pnpm test:cli`

如果改了 schema、查询、缓存、registry/tool API、worker 行为，至少要补一轮对应的 Web 测试或 CLI 测试。
