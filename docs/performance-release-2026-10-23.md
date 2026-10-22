# Web 0.9.8：Cloudflare 复查与发布验收

用户已授权复查通过后提交、推送、部署，并检查线上可用性。日期为 Asia/Singapore 2026-10-23（UTC 2026-10-22）。

## 发布前清单

- 原生产版本：Web 0.9.7，Worker `skillscat-web-production`，version `f416aeb4-a3a2-413b-b667-b4df81e26f61`，部署 `c5e3f5c5-d796-4a72-9893-3f0d461282c3`。该 Worker version 是回退目标。
- 目标：Web 0.9.8，仅部署 Web Worker。D1 schema/migrations、R2/KV/Queue、STATE_DO binding、secrets、OAuth/session 与独立后台 Worker 配置保持不变。
- 生产 compatibility date `2025-01-01`、`nodejs_compat`，已在同配置的隔离 workerd 中执行新缓存 helper，验证三个并发请求只刷新一次、失效期间旧结果不回写、后续刷新恢复。没有跨请求传递 Response 流。
- Cache API 仍按既有 TTL 存储；HTML 的 build 校验和现有失效 key 保留。刷新任务全部使用 `waitUntil`；复查补上 30 秒刷新锁失效时间，避免 Worker 取消任务后长期占锁。既有外层 Workers Cache 配置为 `cross_version_cache: false`。
- D1 改动只并行化独立读取，没有新增 SQL、扫描范围或绑定；短页不计数与越界保护保留。Intl 格式器仅在当前 i18n runtime 中复用。静态代码预加载不额外请求整屏技能详情。
- 复查修复延迟搜索框在 IME composition 期间处理 Enter 的问题；不影响登录组件。
- 本地 Web 970 项测试、全工作区 typecheck 与 lint 通过；使用独立 D1/R2/KV、合成数据进行浏览器和 SSR 验证。发布构建及最终检查以证据 JSON 为准。

## 线上验收范围与写入隔离

1. 版本/bindings：核对 Cloudflare 实际部署 version、静态入口与 SW artifact；保留回退版本。仅推送正常提交，不强推。
2. HTTP：首页及中英文、Recent/Top/Trending、搜索、分类总览/详情、skill、用户页、组织页；分页、空结果、越界和不存在资源；同时检查状态码、正文、Cache-Control/X-Cache/CF-Cache-Status/Server-Timing。
3. 浏览器：直接打开、刷新、站内点击、SvelteKit data、菜单/搜索增强、语言、主题、移动布局；检查正文/卡片/README、静态代码与字体、控制台和失败请求。拦截统计、修改、推荐刷新及头像代理等可能引起生产写入或 GitHub 请求的链路。
4. 缓存：普通 URL 命中；通过新版本或自然过期观察 MISS/后台刷新；不清生产缓存。站内 data 不改成共享 HTML 缓存。
5. 日志：发布前后采集脱敏实时日志，只保存路径、方法、状态、version、outcome、异常类别；不记录 Cookie、请求头或用户数据。不手动触发 cron/queue。
6. 前置只读核对：Recent/Top 的 versioned/legacy R2 对象均不存在，不会触发旧对象删除/提升；49 个预定义分类聚合齐全，不会懒加载补写；选定公开详情的版本化 README 已存在、预计算推荐不存在，因此不会触发推荐刷新；按已知 slug 主键/索引有界读取 D1，业务 rows_written 为 0。
7. 首页 GET 在 R2 快照缺失或过期且缓存完全冷时可能写回快照。首次预检发现快照超过 5 分钟，因此首页线上请求必须等自然快照更新，并核对现有公开/质量资格后再执行；不以测试为由写 R2 或触发定时任务。受此条件约束的场景若无法执行，必须单列未验证。

没有可安全使用的现有生产登录会话时，登录/登出及收藏、发布、上传、组织成员、token 等写流程只报告本地测试和源码检查，不冒充生产验收。

## 实际发布与验收结果

2026-10-23 01:37 SGT（2026-10-22 17:37 UTC）已部署 Web 0.9.8，生产流量 100% 指向 Worker version `85397e08-571c-4704-af1f-03990be08c6b`，deployment `a552807c-8695-44ac-9937-0cb82453c56c`。实现与版本提交均已推送到 `main`：

- `fb84c58`：首屏组件、样式、字体与首页导航预加载。
- `7731852`：公共 SSR 缓存后台刷新、失效保护与列表并行读取。
- `5fd6067`：Web 0.9.8、性能样本与发布前验收清单。

Cloudflare 实际 bindings 与旧版本完全一致，compatibility date/flags 未变。部署只涉及 Web；没有执行 schema migration、独立 Worker 发布、手动 cron/queue 或缓存清空。首次 dry run 因未准备 `.assetsignore` 被 Wrangler 拦截，执行仓库已有 `prepare:assetsignore` 后重新通过，实际部署没有把 `_worker.js` 暴露为静态资源。

详细样本见 [发布证据 JSON](performance-release-evidence-2026-10-23.json)。

| 检查 | 实际结果 |
| --- | --- |
| 本地最终检查 | 970 tests / 132 files、全工作区 typecheck、lint、生产构建与资产 dry run 通过；生产兼容日期的隔离 workerd 并发/失效测试通过 |
| 发布前后 HTTP | 27 条非首页公共路径逐项通过，覆盖榜单/分页、搜索/空结果、分类、用户、组织、公开详情及 404；首页中英文另行通过 |
| 浏览器公共链路 | 12 项交互/错误页场景全部通过；直接打开、刷新、SvelteKit data、分页/后退、菜单、搜索增强、语言、主题、移动布局均有实际浏览器证据 |
| 首页跳转 | 6 个首页场景与 3 条 data 请求断言通过；触屏进入三个榜单；另从首页真实技能卡片进入 `tin-computer/tin/product-demo-video`，点击前 0 次详情数据请求、点击后 1 次，README 正常 |
| SSR / CDN 缓存 | 普通 URL 的 CDN HIT、内部 Cache API HIT 均已观察；Recent 自然临近过期出现 `STALE → HIT`；分类和详情自然过期后出现 `MISS → HIT`；内部读取样本约 3–7 ms |
| 静态入口与 SW | 两个 JS 入口、`/_app/version.json`、`/sw.js` 的线上 SHA-256 与本次构建一致；immutable 资产缓存头正确；真实 SW `mvjtirsy` 注册、接管、刷新与站内导航通过 |
| 生产日志 | 17:37:27–17:50:03 UTC 内采集 442 条新版本事件，全部 outcome=ok；0 exceptions、0 Worker HTTP 5xx、0 error/warn 日志；保存测试路径聚合覆盖证据 |

首页验收先等待自然流量刷新 R2 快照，再通过主键/索引有界 SELECT 核对 34 个去重技能均为公开且 eligible；所有首页场景在快照有效期内执行。两个详情样本的版本化 README 均已存在、预计算推荐对象不存在。测试拦截统计上报、修改请求、头像代理与不在验收范围的 API，没有发布、安装、下载、收藏或写生产业务记录。一次初始 D1 SELECT 使用 `--file` 走了导入接口，其元数据 rows_written=0、changed_db=true；后续改用 `--command` 得到只读结果且 changed_db=false，没有业务写入。

复测中修正了测试自身的几个假设：桌面搜索页 hydration 后按三列把每页 50 调整为 51；SW 版本是构建时间戳而非包版本；禁用 SW/替换带 SRI 的统计脚本会制造控制台提示，主测试改为移除不可用 API、保留原统计脚本并阻止上报，另用允许 SW 的浏览器单独验收。最终主浏览器没有 pageerror、失败网络请求或意外 HTTP 错误，控制台仅保留预期 404 场景的资源提示。

真实 SW 场景观察到 `/terms` 的一次 `Sec-Purpose: prefetch` 返回 503，实际导航成功。这符合 [Cloudflare Speed Brain 对未成功预取返回 503 的文档](https://developers.cloudflare.com/speed/optimization/content/speed-brain/)，不属于本次 Worker 运行异常。记录中保留该样本，没有把它混入正常业务请求统计。

截图：[中文首页](performance-release-2026-10-23/production-home-zh.png)、[移动首页](performance-release-2026-10-23/production-home-mobile.png)、[分类菜单](performance-release-2026-10-23/production-menu.png)、[移动详情](performance-release-2026-10-23/production-detail-mobile.png)、[首页卡片跳转后](performance-release-2026-10-23/production-home-skill.png)。头像使用拦截占位，截图用于核对布局与正文。

## 验收边界

本次完成的是上述有界匿名公共链路。没有执行生产登录/登出或用户写流程，没有验证头像源/GitHub 连通性，没有触发后台 cron/queue。性能百分比仍来自隔离环境对照实验，未获得生产计费 CPU、跨区域并发效果或真实用户 CrUX/RUM P75；缓存读取的 Server-Timing 不是整页加载时间或计费 CPU。
