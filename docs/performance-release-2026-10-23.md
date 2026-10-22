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

实际提交、部署版本、检查时间与结果将记入发布证据；构建/上传成功不等于验收完成。
