# SEO、持续发现与成本验证

这些变更需要先应用 Drizzle 生成的 `0033_melted_norman_osborn.sql`、`0034_cynical_crystal.sql`，再发布 Web 和现有 indexing、classification、github-events、trending、search-precompute workers。没有新增 Worker、binding、queue、付费模型服务或管理接口。

## 配置与兼容

- github-events 与 indexing 的 `DISCOVERY_MAX_QUEUED_PER_DAY` 必须一致，默认 500；前者每轮最多 40、单渠道最多 20，下游估算积压达到 100 时暂停新增根任务。嵌套路径投递也计入原子每日额度，每条消息最多扫描 25 个路径；续跑消息计入额度。手动提交与强制重建保留原有用户行为。
- `discovery_daily_stats` 按来源记录投递、完成、新增、失败；`__budget__` 是内部额度行，统计渠道产出时必须排除。任务重试不计新增，只有创建有效 skill 才计新增。队列积压是按两日投递/完成差值估算，实际积压仍以 Cloudflare Queue 指标为准。任务中断可能暂时保留少量已预留额度，到下一 UTC 日重新分配。
- `FREE_MODELS="openrouter/free"` 用于免费介绍修复。分类请求同时生成中英文介绍，最多 500 输出 token；单独介绍修复绝不使用付费回退。无免费模型、免费额度暂停或任务为空时，不请求模型。修复每轮默认扫描 40 条，20 秒时间预算，单次模型请求最多 15 秒；新内容优先，持续失败指数退避至一天。
- 推荐算法默认 `v2`，旧配置 `v1` 自动归一为 `v2`，避免继续读取旧推荐。无需立即全量重算，沿用有界后台刷新及轻量回退。
- 英文 SEO URL 固定英文 SSR；`/zh-CN` URL 固定简体中文 SSR，不由 cookie 决定。日语、韩语界面能力保留在非 SEO 页面。只有当前源版本的合格中文介绍才提供中文详情索引入口；未就绪访问返回 307 到英文。原始 SKILL.md 不翻译。
- `first_published_at` 用于公开转换，新建公共记录兼容 `created_at`；历史记录按 `created_at` / `indexed_at` 回退，不进行全表回填。`content_updated_at` 只用于实质内容或介绍变化。
- 首页和列表数据共享，HTML 按 URL 语言隔离；trending 使用统一 R2 快照。首次屏幕候选不足以满足作者/仓库上限时允许缩短列表。中文列表中的未确认翻译详情仍链接英文。
- sitemap 的外部路径保持不变，内部缓存升级为 v3，skill 分片每片 5,000 个原始技能，双语合计最多 10,000 URL。每日完整构建采用 slug keyset；recent 覆盖首次公开、内容更新与介绍更新。相同 XML 哈希不重写 R2，现有快照由后台刷新，缺失时才回源构建。故障时会继续提供已有快照，应观察每日完成标记。
- 桌面 footer 的 `showDesktopAdSlot` 默认 false。关闭时不创建广告节点、不占高度；将来显示容器为 1,024px 以上居中 728×90。此变更没有广告脚本、请求或 publisher ID。

## 本地验证与发布后观察

本地检查使用生成的全部 migrations、SQLite 查询计划及 20,000 条状态数据，覆盖摘要污染、源版本竞态、首次收录排序、同仓库限制、每日共享额度、嵌套续跑、搜索分页和限流、预计算退避。执行 Web 测试、`pnpm typecheck`、`pnpm lint`、Web build 和 CLI 测试；浏览器检查使用隔离的本地 D1 / R2 / KV，不接触线上数据。

获准上线后运行 `node scripts/seo-health-check.mjs --sample-size 5`。脚本检查 sitemap、canonical、URL 语言、hreflang 对称性和污染介绍。固定一组新/旧、热门/冷门、中/英文详情，在 Search Console 核对 Google 选择的 canonical、重抓取、索引状态和手动操作报告。按 14 / 28 天比较曝光及已索引详情，不承诺具体收录数量或日期；IndexNow 不是 Google 提交通道。

以部署前 7 天为成本基线，对比后续 7 天的 Workers 请求/CPU、D1 reads/writes、R2 操作与存储、KV 操作、Queue 操作及付费 AI 用量，同时计算每千 PV、每百个有效新增的消耗。日志 `discovery_run`、`discovery_channel`、`indexing_yield` 和每日表提供产出依据。若新增下降但资源上升，先降低发现每日/每轮额度和免费修复批量；不要提高 cron 频率。没有实际账单数据，不能宣称总成本已不增加。

回退应用代码时保留新增表和列；不要删除已有数据或逆向执行破坏性 migration。广告保持关闭。部署、提交、推送仍需单独授权。
