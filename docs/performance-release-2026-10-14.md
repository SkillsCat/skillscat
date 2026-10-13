# 性能优化发布与线上验收 — 2026-10-14

状态：**代码已提交推送，Web v0.9.6 和受影响 Workers 已上线；已测 Web 读取链路通过，后台完整验收仍有未覆盖项。** 时间使用 UTC，新加坡日期为 10 月 14 日。

结构化结果见 [验收证据](performance-release-evidence-2026-10-14.json)。优化原理与此前基线见 [CPU 优化记录](worker-cpu-optimization-2026-10-13.md)。不能把本次有限样本描述成全站所有功能无 bug，或认定线上 CPU/账单已降低。

## 发布范围与版本

从独立 checkout 构建，最终 Web 源码为 `786610f`。保留已部署过的公开用户页分页修复。原工作区 TypeSafe 分类、安全分析及其文档改动未混入提交或构建。没有 schema、migration、binding、secret 名称、cron 表达式或 queue consumer 配置变更。

| Worker | 当前 100% 生效版本 | 发布前回退版本 |
| --- | --- | --- |
| web | `b887890f-0969-4bcd-99ce-ced5a4157836` | `de99cb3b-b5ba-4b82-b7d6-9d30150e71c4` |
| indexing | `6e03abe4-be7b-40db-8c24-75eae251da0a` | `58be10a7-6aae-4007-a799-78681d41f0a5` |
| virustotal | `3f349028-776a-4152-825b-23831d20a34d` | `d4146bcc-816d-498a-8fa2-a38f717c4e1c` |
| search-precompute | `718af839-9231-4a3d-8cfc-a06985d38d0f` | `0c337bd6-b8a0-4d41-a517-8d6c91990c80` |
| trending | `67c66825-815a-45d8-9872-d741f26a32a5` | `a1785a96-f215-4689-99aa-f6c786373a67` |

Web 首次性能发布版本是 `d6f1b395-772e-4356-b297-45226cae0706`，未读计数修复中间版本是 `30dcb70f-14e8-495c-96ab-67cc5a4dec8a`。最终部署同时修复图标路径。部署使用 `--keep-vars`，从 Cloudflare API 再核对实际生效版本和配置。仅 deployment annotations、cron 的 modified_on 随部署变化。

HTML Cache API 前缀升级至 v5，未清理生产缓存。最终静态资源包保留本次首轮发布的旧 immutable 文件，避免缓存 HTML 引用的旧资源立即失效。旧版本与数据库仍兼容，回退无需回退数据库；但发布前 Trending 版本本身存在下述错误，不应将它作为修复该故障的方案。

提交按逻辑拆分：

- `031ce32`：保留公开用户页有界分页修复。
- `1874443`：HTML 流式缓存、README 延迟读取、auth 实例复用、CRC32、bundle hash 和搜索索引批量写入优化。
- `3929c04`：Web v0.9.6。
- `ca1f6dd`：真实 Better Auth OAuth 流程隔离回归。
- `7f9dbb6`：Trending D1 compound SELECT 限制修复。
- `73a0f9d`：未读消息请求取消问题修复。
- `786610f`：图标路径修复。

## 复查与修复

优化复查覆盖共享缓存 Cookie/错误页排除、私有内容授权、locale 与缓存失效、README 空字符串回退和 SEO、ZIP 字节一致性、bundle hash 兼容、D1 参数上限和事务回滚。新增 OAuth 测试运行真实 Better Auth 与已迁移的独立 SQLite：两个独立 GitHub 登录 state/callback、会话读取及退出互不干扰；GitHub HTTP 为本地 mock。

线上验收额外发现并修复三项问题：

1. **Trending 每小时任务报错。** 17:00:35 捕获发布前版本的自然 cron 异常 `D1_ERROR: too many terms in compound SELECT`。每批 40 个仓库生成的 UNION 超过 workerd 的 compound SELECT 上限 5。改成每批最多 5 个；11 仓库回归验证 3 个分块。真实隔离 workerd/D1 复现旧实现 500，修复后 200，并返回预期 10 条 sibling 更新。官方限制见 [workerd SQLite 源码](https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite.c++) 的 `SQLITE_LIMIT_COMPOUND_SELECT`。未人工触发生产任务。
2. **登录后未读计数请求自取消。** 浏览器看到 `/api/notifications/unread-count` 被 abort 后不再恢复。Svelte effect 同步读取其内部修改的响应式加载/缓存状态，导致 effect 自身重跑并取消请求。请求 bookkeeping 改为普通变量，effect 仅依赖路径和用户，并拒绝被取消请求的结果。在真实 Svelte 浏览器 fixture 中，旧版 started=1/completed=0/aborted=1；修复版快速切换用户和页面后 started=3/completed=1/aborted=2，计数正确。随后退出取消第 4 个请求，计数保持 0。最终线上接口 200、`no-store`，站内导航与刷新均正常。
3. **嵌套路由图标 404。** 一级页面的相对 favicon 地址在站内进入 `/user/skills` 后解析成 `/user/favicon...`。改为站点根路径，与已有字体和 Logo 路径一致。最终版本实测同一跳转不再出现该组 404。

## 本地验证

- 原工作区：903 个 Web 测试、191 个 CLI 测试通过；typecheck、lint 通过。
- 最终隔离发布 checkout：122 个文件、870 个 Web 测试通过；全仓 typecheck、lint 和 Web production build 通过。数量差异来自排除的 TypeSafe 测试。
- indexing / virustotal / search-precompute 独立 Worker bundle 通过。
- 构建保留既有 `SkillManageDialog.svelte` 的未使用 `.sr-only` CSS 警告。
- 仓库仅有 CLI 发布 workflow，本次 Web 发布没有可引用的远端 CI 测试运行；上述自动化结果均为本地执行。

## 实际浏览器与 HTTP

使用真实 Edge 和已有授权会话。最终版本在 17:25–17:30 验证下列范围：

| 场景 | 实际结果 |
| --- | --- |
| 登录态、我的技能 | `/api/auth/get-session` 200、有效用户/会话、`no-store`；站内进入我的技能时 `__data.json` 200、`private, no-store`；刷新仍可访问受保护页面 |
| 未读计数、收藏状态、收藏页 | 读取接口和页面正常；未标记已读、未新增/删除收藏 |
| Recent、Top、Trending | 正文与 24 项列表正常；Recent 的点击翻页、刷新和跨页不重复已在首轮浏览器验证 |
| 分类列表、Testing 分类 | 正常；分类详情 24 项；中文路径 `/zh-CN/category/testing` 正文为中文 |
| 搜索 | 导航栏输入 testing 并提交，SvelteKit data 200，51 项结果；无匹配词显示空结果，data 200 |
| 用户页 | `/u/anthropics` 显示 126 项总数、每页 24 项；点击第二页正常；首轮验证两页无重复并可刷新 |
| 组织页 | `/org/yottameta` 正常展示现有组织与合法空列表 |
| skill 详情 | 已有公开 skill 的 README 正文 8,934 字符、5 个推荐、精确 slug-first 安装命令；真实截图检查排版正常 |
| 不存在的 skill | HTTP 404，正文显示 404/Skill Not Found，不是 500 错误页 |

首页在首次性能版本上使用普通 `/` 实际打开，36 个 skill 链接、正文正常；17:05 的 HTTP 也通过。最终图标修复版未重复触发首页 SSR：已有 R2 stats 对象已过期，访问会写入衍生对象，违反只读验收约束。该项最终版本复验标记为未覆盖，不能用旧版本结果替代。

最终版本普通 URL 的 28 个 HTTP 请求通过预期状态/正文检查，另有 1 项首页跳过记录。覆盖列表第二页、搜索空结果/越界、分类/skill/用户/组织不存在资源及中文分类。观察到 HTML/registry 的 MISS 和 HIT，未使用验证参数或清缓存。Registry 使用受支持的 `skillscat/0.2.2` User-Agent，搜索结构正常；已有 SKILL.md 文件 API 与 registry 内容 SHA256 均为 `9191177c4a8ef11a20dace786d708506b22d43e748c71287bb823de0dc812dad`。路径穿越返回 400；匿名会话为 null、未读接口 401、私有页面 302。

浏览器未观察到未处理的 JS 异常；最终登录导航、刷新、搜索和详情采样中静态资源正常。CDP 某些批次出现 buffer truncation，不能声称整段浏览会话的每个网络事件都已留存。详情页唯一应用 console error 来自主动阻断的访问统计；相应请求确认以 inspector 原因阻断。分析、自动推测加载、安装、下载与推荐刷新请求也在验收 tab 内阻断，结束时关闭该 tab。

生产读取前检查已有 R2 原文、派生 README、推荐对象和列表缓存：原文/渲染缓存存在，推荐对象缺失走只读 fallback，Recent/Top 主备 R2 列表均缺失走有界 D1 查询，分类统计已存在。没有额外触发 GitHub/AI 请求，没有测试账号、授权记录、生产业务写入、统计上报、清缓存、队列投递或手动重算。现有会话的正常读取/刷新不等于新建 OAuth 登录验证。

## 自然运行日志与未覆盖项

- 按版本采集 Web 与四个 Worker 的自然日志；最终 Web 样本无 Worker exceptions。早期版本的图标 404 与 Trending 异常分别关联到时间、路径和版本后修复。自然流量中的 WordPress 探测和不存在的 `/a2a/tasks/...` 探测返回 404，不属于应用 5xx；后者的请求 ID 未保存。
- search-precompute 新版本 17:15:46 自然 cron 完成，outcome=ok、CPU 396 ms、wall 40,066 ms，无 error/exception。virustotal 新版本连续自然 cron 正常。
- Trending 修复后的下一次自然 cron 是 **18:00 UTC（新加坡 02:00）**，本次观察截止前尚未发生；本地真实 D1 通过不能代替生产 cron 验收。
- indexing 新版本未观察到自然消费，运行态验收未完成。17:08、17:24、17:32 的读取均见主队列 5 条、DLQ 12,764 条，样本期间没有增长；未读取消息体、重放、清空或修改这些消息。DLQ 积压仍需单独排查，不能把后台状态报告为全部健康。
- 新的 GitHub OAuth 授权/生产退出重登、发布上传、收藏修改、下载/安装计数等写流程未在生产执行。鉴权隔离、ZIP、hash、搜索写入/失败回滚在隔离测试中验证。
- 没有完整 24 小时新版本成本窗口，也未完成按路由与缓存状态配对的 CPU/D1/R2/Queue 成本比较。

因此发布已生效，已覆盖的 Web 读取功能通过；**完整上线验收仍未完成**，剩余项是最终首页无副作用复验、Trending 自然运行、indexing 消费/积压及完整成本周期。
