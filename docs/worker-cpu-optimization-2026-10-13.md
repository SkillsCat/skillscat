# Worker CPU 优化与验证记录

后续提交、线上部署、浏览器验收与新增故障修复见 [2026-10-14 发布记录](performance-release-2026-10-14.md)。下文保留当时尚未发布的验证快照。

本次完成本地实现与验证，未提交、部署或更改生产业务数据。工作区原有的 CLI、TypeSafe、用户页等改动不属于本次优化。

结构化基线、被动采样及本地运行时结果见 [验证数据](worker-cpu-evidence-2026-10-13.json)。

## 线上基线

通过 Cloudflare GraphQL 只读查询获取，时间窗口为 **2026-10-12 14:42:31 至 2026-10-13 14:42:31 UTC**。表中时间统一由微秒转换为毫秒。总 CPU 为 4,394,377.970 ms；Web 占 **98.685%**。

| Worker（省略 skillscat- / -production） | 调用数 | 总 CPU ms | P50 ms | P99 ms | 运行错误 |
| --- | ---: | ---: | ---: | ---: | ---: |
| web | 60,854 | 4,336,599.491 | 44.495 | 385.071 | 0 |
| virustotal | 1,447 | 17,156.204 | 11.787 | 24.695 | 0 |
| indexing | 89 | 15,956.282 | 163.686 | 740.032 | 0 |
| search-precompute | 24 | 9,273.325 | 357.015 | 1,082.094 | 0 |
| classification | 98 | 6,434.239 | 59.195 | 214.124 | 0 |
| security-analysis | 173 | 4,833.577 | 4.329 | 125.690 | 0 |
| metrics | 1,311 | 2,671.627 | 1.566 | 6.438 | 0 |
| github-events | 290 | 837.113 | 2.456 | 23.916 | 0 |
| trending | 24 | 483.220 | 20.195 | 34.242 | 24 |
| tier-recalc | 1 | 132.892 | 132.892 | 132.892 | 0 |

archive、resurrection 等未出现在该窗口的返回结果中，不能据此认定它们没有成本。Durable Object CPU 也不在这份 Workers 查询的覆盖范围内。

被动 tail 观察到 Web 版本 `de99cb3b-b5ba-4b82-b7d6-9d30150e71c4`。40 秒、20% 采样取得 3 条自然请求：两次 MCP 请求 CPU 为 4 / 32 ms，一次公开 skill 详情为 118 ms；这不是完整路由分布。未对生产发送测试业务请求。

对上述版本捕获了 10 秒自然流量 CPU profile。`loadSkillReadmeFromR2 -> text` 是显著采样栈，同时存在 D1 JSON 转换与缓存请求构造开销。采样只来自当时选中的 isolate，包含 idle/program/native 帧，不能将其比例直接推算成全站可节省比例。采样机制见 [Cloudflare 生产 CPU profiling 文档](https://developers.cloudflare.com/workers/observability/profiling-in-production/)。

## 实现

1. **Web HTML 缓存直接传递 Response.body**：命中、写入均避免整页 `text()` 解码和重新编码。保留原 key、TTL、locale 分区、可见性检查、安全检查、Markdown 协商与 waitUntil。写入排除错误页和 Set-Cookie 响应。
2. **README 按需读取**：SSR 与数据导航先查已渲染 HTML，缺失时才读取原始 R2 Markdown。无 description 的 skill 仍读取原文以保持 README 驱动的 SEO indexability；私有内容继续走既有权限检查和独立渲染。
3. **复用 Better Auth 初始化**：按 D1 binding 保留一个当前配置实例，校验 base URL、可信来源配置和所有相关密钥。配置变更或初始化失败会重建。请求头、session、user 不进入该缓存。
4. **VirusTotal ZIP CRC32 改为查表**：每字节八次位运算改为一次查表。复用到现有 Web ZIP 路径，压缩格式、文件排序和 ZIP 字节保持一致。
5. **indexing 共用清单规范化与排序**：一次生成 exact / semantic 两类 bundle hash，保留原字段顺序、规范化规则和 SHA256 值；上传共用路径同步使用。
6. **search-precompute 批量 INSERT**：每条 INSERT 最多 16 行、96 个绑定参数，低于 [D1 每条查询 100 个参数的限制](https://developers.cloudflare.com/d1/platform/limits/)。满额 96 terms + 160 prefixes 从 256 条 INSERT 降为 16 条。删除仍按 skill_id；删除与插入放在同一个 D1 batch 中，插入失败时回滚保留旧词条。正常写入的行数、内容、权重、时间戳不变。

未修改 schema、migration、binding、cron 或 queue；不新增 GitHub / AI 请求，不通过降低分类或安全分析质量节省 CPU。D1 写入行数不变，减少的是 SQL 语句包装、响应和序列化工作。正常 README 缓存命中会减少 R2 原文读取。现有缓存失效 key 与派生 R2 路径保持兼容，无需清理生产缓存。

## 本地 CPU 基准

复现命令：

```sh
node apps/web/scripts/benchmark-worker-cpu.mjs 4b17b853f00552737703b85b61207275c0cb0e87
```

基准从 Git 指定 revision 读取旧版实现，对照工作区代码。以下是 2026-10-13 14:57:43 UTC 的 Node v26.5.0 / arm64 结果，五轮预热后的进程 CPU 中位数，交替执行前后版本。

| 测量范围 | 修改前 ms/次 | 修改后 ms/次 | 降幅 |
| --- | ---: | ---: | ---: |
| auth 初始化 + 无 Cookie 的 getSession | 0.47468 | 0.03392 | 92.85% |
| VirusTotal 格式 4 MiB stored ZIP 构建 | 45.74230 | 8.56995 | 81.26% |
| 1,000 文件清单的两种 bundle hash | 0.55533 | 0.40697 | 26.72% |

这是有限合成输入的本机函数基准，排除了网络等待；不等于 Cloudflare Worker 的整体降幅，也不代表账单已经下降。脚本同时比较 ZIP 完整字节和双哈希结果，差异会报错。后续复现应使用优化提交之前的 revision。

## 验证与边界

- Web 全套 Vitest：123 个文件、901 个测试通过；Web typecheck、根目录 ESLint、生产 Web 构建通过。
- indexing / virustotal / search-precompute 使用 workerd/worker/browser 条件完成独立 bundle。
- 回归覆盖流式缓存、legacy promotion、写入失败、Cookie/错误页隔离、私有 skill 可见性、locale、鉴权配置切换、README 缓存与 SEO、CRC32 标准向量、ZIP 解包、哈希一致性。
- 搜索写入使用完整 migrations 创建的本地 SQLite 验证数据、跨 skill 隔离、替换/清空与绑定参数上限。没有运行生产 SQL 写入。
- **隔离 workerd 运行时**：真实 Cache API 首次 MISS、再次 HIT，中文 HTML 字节一致；真实本地 D1 中创建两个测试用户及签名会话，在同一个 auth 实例上并发执行 `alice / bob / 匿名 / alice / bob / 匿名`，六次身份全部正确。测试资源仅存在于本次临时 Miniflare 实例，没有生产 bindings。Node 侧 D1 proxy 曾等待不返回，改为在 Worker 内执行本地 D1 操作后完成验证。
- Web 构建仍提示既有 `SkillManageDialog.svelte` 的 `.sr-only` 未使用 CSS selector；构建成功。

**已有线上故障待继续排查**：trending 在基线窗口 24 次执行全部返回运行错误。Workers Observability 历史日志 API 返回 HTTP 403 Authentication error，无法确认异常堆栈或缓存刷新受影响的具体环节。没有以重跑生产任务的方式验证。该 Worker 的低 CPU 不能被视为健康或优化成功。

## 追加 review

2026-10-13 按用户要求复查全部 CPU 优化改动。发现并在本地修复：

- **README 回归**：D1 的 readme 为 `''`、R2 有原文且 description 非空时，原来的 SSR 会回退读取 R2；延迟读取中的 `??` 将空字符串视为有效内容，导致正文缺失。改成与原详情读取一致的空值判断，并保留实际读到的原文存在状态。新增测试在修复前失败、修复后通过。
- **搜索索引既有失败风险**：删除旧 terms / prefixes 与批量插入分开执行；后续插入失败会留下空索引。改为同一个 [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。两个回归测试在第二个分块制造重复主键，确认旧词条和时间戳保留，再验证重试。另在隔离 workerd 的真实本地 D1 binding 上验证回滚、96 / 160 条重试和清空，全部通过；未连接生产资源。

补充鉴权测试使用真实 Better Auth、已迁移的本地 SQLite 和签名 Cookie，覆盖并发两个用户、匿名与无效会话、响应 Cookie 隔离、session token 撤销，以及初始化失败重试和配置切换时旧失败不得清除新实例。哈希增加从优化前 revision 提取的固定期望值，避免仅让两个共用内部函数互相比较。

review 后新增 7 个测试，总计 901 个通过。源码复查还覆盖共享缓存的权限与 Cookie/错误页排除、locale/失效 key、ZIP CRC32 与下载路径、bundle 输入不变性和 D1 参数上限。本地验证通过不代表已完成生产验收；本次仍未提交或部署。

## 部署后需要对比的指标

需先按 AGENTS.md 获得部署授权，并完成其中规定的完整线上验收。本次未部署，因此下面均未完成：

- 记录实际发布版本与可回退版本；核对 Web 和三个受影响后台 Worker 的版本与 bindings。
- Web 按 HTML HIT / MISS、详情 README HIT / MISS、API/MCP、登录态分组，对比同类流量的 CPU/request、P50/P95/P99 与总 CPU。保持请求量、路由组成和观察窗口可比。
- 后台按自然发生的 queue/cron 执行比较 CPU/处理条目、执行次数、错误、重试、积压，同时核对 D1 rows read/written、R2 操作数、GitHub/AI 请求数没有成本反弹。
- 至少观察一个完整的 24 小时后台周期。不能用本机性能、HTTP 200、一次 profile 或部署成功代替线上验收。
- 只读验收，拦截自动统计上报；不清缓存、不投递测试队列消息、不人工触发重算。CPU 与 wall time 的区分参考 [Cloudflare 指标说明](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)。
