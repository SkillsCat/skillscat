# Skill discovery quality

首页、Recently、Top、Trending 和相关推荐只展示 `quality_status = 'eligible'` 的公共 skill。Recently 继续按首次发布时间倒序，不新增同作者或同仓库限额。普通搜索、详情和精确 slug 安装保持现有访问规则；质量状态不替代 visibility。

状态为 `pending`、`eligible`、`low_quality`，原因与规则版本保存在 skills 中。`eligible` 表示通过当前基础检查，不代表经过全面语义审核。v1 识别空正文、纯占位内容，以及“声称有代码单元和测试、执行说明为空泛模板、安装包缺少所引用实现”的组合特征。名称、语言、长度、star、仓库数量均不能单独触发低质判定。文件清单缺失、正文读取失败或超预算保留 pending，不当作低质。

## 固定成本

- 新收录：复用已下载的 SKILL.md 和文件清单，评估合并到 indexing 现有 lineage 写入；上传合并到现有 INSERT。无新增模型调用、GitHub 请求、相似度全库查询或 queue。
- 存量：复用 trending 的每小时 cron，每轮最多 20 个候选、40 次 R2 GET、20 条记录更新。一天最多 480 个候选、960 次 R2 GET；D1 的计费行写还包含索引维护。
- 正文检查限制 65,536 字符；R2 存量读取先限制 65,536 字节。正文哈希和提交版本不匹配时不批准，缺失内容至少退避 24 小时。完成的记录不再进入 pending 队列；修改内容会重新评估。
- 列表使用 eligible 部分索引。列表可浏览总数由 worker 写入 R2，Cache API 缓存 5 分钟；冷启动回退最多统计 2,400 个索引项，不做全表 COUNT。
- 旧推荐快照使用一条按 ID 批量查询复核资格，结果按候选 ID 集合缓存 60 秒，避免逐 skill 查询。历史 HTML 和浏览器缓存仍遵循其 TTL，不承诺跨数据中心瞬时撤回。

## 发布顺序

新迁移默认把尚未评估的存量设为 pending。必须先准备合格候选，再部署推荐准入代码，避免首页为空。

1. 应用 Drizzle 生成的 `0035_productive_tombstone.sql`；旧代码暂时不读取质量字段。
2. 运行 `node scripts/quality-review.ts --remote --limit=100 --output=tmp/quality-bootstrap-001`。脚本只读取有界的 recent/trending 候选和已有 R2 内容，默认输出 `review.json`、`apply.sql`、`restore.sql`，不写数据库。最多允许 `--limit=200`，无需 AI/GitHub。
3. 检查报告中的合格内容是否足以覆盖首页。通过后执行报告中的 apply.sql（或使用新的输出目录再次运行脚本并加 `--apply`）。SQL 按 ID、内容哈希、提交 SHA 和 pending 状态保护，保留恢复脚本。头部不足时先补充评估，不放宽质量门槛。
4. 部署 web、indexing、trending。分类 worker、bindings 和 secrets 不变。新列表/页面/在线推荐缓存使用新版本，R2 旧推荐正文经过资格复核后才能展示。
5. 验证首页、Recent 分页、相关推荐、正常 skill 的精确 slug 安装；观察每小时质量补评估的处理数量。

迁移、提交和部署仍遵循 AGENTS.md 的确认要求。脚本默认使用现有 Wrangler 配置及登录凭据；也支持 CLOUDFLARE_API_TOKEN，不输出凭据。

## 2026-09-07 线上干预

对 `FuRongJun-1999/CommonTrustProtocol` 的 63 条 browser 模板内容，已逐条取得与线上 content_hash 相符的正文，确认命中 `unbundled_generated_unit`。首次干预时线上独立质量字段尚未上线，因此将这 63 条从 public 改为 unlisted，保留详情和内容；该仓库另一条记录仍为 public。没有批量删除仓库或内容。

本地干预记录和按内容哈希保护的回滚 SQL 保存在忽略提交的 `tmp/quality-intervention-2026-09-07/`。迁移和部署现已完成，这 63 条已全部记录为 low_quality，继续保持 unlisted。将来如恢复 public，应保留质量判定，避免重新进入推荐。

干预后实测首页和 Recently 无上述 browser 链接，抽查原详情 URL 返回 200。现有凭据无法执行 Cloudflare purge；旧相关推荐可能仍在历史 HTML/R2 推荐缓存中。新的资格复核代码负责阻止旧 R2 推荐对象继续传播不合格内容，已有客户端/边缘 HTML 等待 TTL。


## 发布完成记录（2026-09-07）

- 线上迁移 0035 已应用；indexing、trending、web 均已部署。
- 两批预评估共 200 条，196 条合格，4 条因正文哈希不一致继续 pending。合计 243 次 R2 GET，没有模型或 GitHub API 调用。补评估脚本会尊重 pending 的重试退避时间。
- 首页、Recently 前两页、Top、正常与下架 skill 的详情/推荐接口已核验；83 个去重后的展示条目均经 D1 确认为 public + eligible。
- 使用 CLI 真实 User-Agent 验证两个精确 slug 的 files 接口，均返回 200 且包含 SKILL.md。普通审计 User-Agent 会被原有工具接口安全策略拒绝，未修改该策略。
- worker 的每小时 cron 配置已注册；未额外触发全量回扫或等待下一次定时执行。
- 构建和三项 Wrangler 部署预检通过；此前全量 834 项 Web 测试、类型检查和 lint 通过。没有执行 git commit、push 或 tag。

| 服务 | Cloudflare Version ID |
| --- | --- |
| Web | ea9cffd8-dab0-4512-bf21-fcb6f18b0469 |
| indexing | 58be10a7-6aae-4007-a799-78681d41f0a5 |
| trending | a1785a96-f215-4689-99aa-f6c786373a67 |

发布前版本、部署回执和线上检查结果保存在 `tmp/quality-release-2026-09-07/`。两批候选报告和按内容版本保护的恢复 SQL 分别位于 `tmp/quality-bootstrap-20260907-001/`、`tmp/quality-bootstrap-20260907-002/`。
