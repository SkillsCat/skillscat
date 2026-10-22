# 页面切换与 LCP 优化 — 2026-10-22

状态：本地实现和验证完成，Web 0.9.8 已部署并完成有界公共链路验收；发布记录见 [Cloudflare 发布验收](performance-release-2026-10-23.md)。基线为 `27d941970d5dd617b04165c5b0ee9ec1976e6563`。

登录、OAuth、session、用户菜单、鉴权判断与私有缓存策略均未修改。10 月 23 日的追加优化修改了 hooks 的公共 SSR 缓存分支，见下文。没有 schema、migration、binding、secret、独立 Worker 或 CLI 改动。首页列表、详情 README 和推荐仍由 SSR 输出，不以空壳或客户端补加载换取首屏指标。

## 修改

- 分类菜单完整按需加载，首屏不再执行菜单控制器。保留无 JavaScript 分类链接、鼠标展开、键盘焦点、Escape、完整分类与底部链接；修正菜单内容测量及屏幕边缘定位。
- 页脚语言选择器使用原生 select，沿用原有语言切换逻辑、四种语言和外观，不再同步加载 Select 交互依赖。
- Recent/Top/Trending 与分类页保留静态可输入搜索框，交互时才加载建议、历史等完整搜索组件。切换等待输入暂停 120 ms，避开 IME composition，保留输入值、选区和焦点，离开页面时取消定时器。
- 仅首页三个列表入口和导航 Trending 使用 hover 数据预加载。skill 卡片和其余公共导航仅预加载代码，页面仍在点击时读取数据；没有全站或整屏批量数据预取。保留原有 body `tap` 策略，不改变登录/用户入口。
- 卡片标题在 hover/focus 时检查截断，取消每张卡片首屏的 ResizeObserver 和布局读取；同一语言重复使用 Intl 数字格式器。首页首排头像使用 eager，字体预加载按标题实际 700/800 字重选择。
- SvelteKit 将小于 32 KiB 的样式文件内联进 SSR HTML，较大文件仍独立缓存；当前首页只剩一条阻塞样式链接。代价是 HTML 增大，原样式文件仍由框架正确标记，避免 hydration 重复请求。
- Recent/Top 的分类 hydrate 与首屏总数读取并行，Trending 首屏快照与总数并行；保留短列表不查总数、越界页先检查上限的成本保护。分类列表两条独立读取并行，已有 Cache API key 使用 waitUntil 后台刷新。查询数量、返回列、LIMIT、可见性复核和失效 key 不变。
- Recent/Top/Trending 的 HTML 与 SvelteKit data 响应增加 `Server-Timing: list_data`，区分 HIT/STALE/MISS。

框架选项根据项目安装的 SvelteKit 2.70.3 源码核对；设计依据见 [预加载说明](https://svelte.dev/docs/kit/link-options) 和 [样式内联的缓存权衡](https://svelte.dev/docs/kit/@sveltejs-kit-vite#inlineStyleThreshold)。

## 首轮性能证据（10 月 22 日）

原始数据、每轮样本和功能检查记录见 [JSON 证据](performance-optimization-evidence-2026-10-22.json)。

使用 production build + 本地 workerd，独立 D1/R2/KV 和 72 条合成 skill；Chrome headless，390×844 视口，4 倍 CPU 限速，每个路由三个新浏览器上下文，禁用 Service Worker。配置 CDP 100 ms/200 KB/s 网络模拟，但 loopback、请求拦截和真实 WAN 不等价。

| 场景 | 修改前中位数 | 首轮版本中位数 |
| --- | ---: | ---: |
| 首页 LCP | 464 ms | 408 ms |
| Recent LCP | 560 ms | 404 ms |
| Skill 详情 LCP | 596 ms | 380 ms |
| 首页 → Recent，悬停后点击 | 466 ms | 91 ms |
| Recent 首屏 JS（解压后） | 449.9 KB | 364.1 KB |

导航测试先悬停 Recent 链接 300 ms，再测点击到目的页 DOM 更新及两帧的时间；不代表纯触屏点击的收益。JS 大小为浏览器 decodedBodySize，不能当作 gzip 网络传输量。Cache API/R2 在各轮中逐渐预热，因此不依据这些本地 TTFB 推断生产冷启动、跨区域 D1 或线上缓存表现。保留中间样本，避免只展示最快的一次。

## 回归与范围

- Web：130 个测试文件、950 项测试通过。新增 6 项真实迁移 SQLite 测试，验证 count 未结束时独立查询已经开始、短列表避免 count、Trending 越界页不读快照。
- Web typecheck：0 errors / 0 warnings；全仓 lint、production build、`git diff --check` 通过。
- 实际浏览器：菜单 hover/键盘/Escape、首次快速输入与清空、IME 组合/选区保留、分页点击/后退/刷新、分类空结果、中英切换、暗色、移动菜单与详情、无横向溢出。最终记录无 pageerror、console error 或失败 HTTP 响应。
- 无 JavaScript SSR：首页及中文首页、Recent/第二页、Top、Trending、分类总览、分类详情及中文详情、skill README、Docs、Privacy、Terms；越界页、不存在 skill/分类的 404 正文和 no-store。另验证 820 px 平板菜单边界，共 17 项通过。
- 截图：[桌面分类菜单](performance-2026-10-22/menu-desktop.png)、[移动端暗色详情](performance-2026-10-22/detail-mobile-dark.png)。

最终复查发现并修复了延迟升级搜索框的快速输入竞争，以及菜单边框导致的底部裁切；修复后重复输入 5 次均保留文本，IME/光标与菜单几何检查通过。

首轮记录时尚未部署或测量生产环境，没有 CrUX/真实用户 P75 结果，也未新增生产登录态验证。没有访问生产 bindings、写生产业务数据、发送队列任务或执行发布。上线后仍需按 AGENTS.md 做有限、无业务写入的生产验收；本地结果不构成线上 LCP 改善承诺。

## 首页直接点击与公共 SSR 缓存（10 月 23 日追加）

首页可见的榜单入口和技能卡片启用 SvelteKit `preload-code="viewport"`，提前加载目标路由的静态代码。不同技能复用同一详情路由模块；不会因为首页有 36 张卡片而请求 36 份详情数据。榜单维持 hover/tap 数据预取，技能详情维持 tap。框架在 Save-Data 模式下关闭自动预取，实测该模式仅加载首页节点，点击仍可正常进入详情。

此前已存在首页、榜单第一页、分类总览、分类第一页和公开技能详情的 HTML Cache API 缓存。本轮增加临近过期时的后台刷新：

- 首页仍保留最多 60 秒，其他已有公共 HTML 仍最多 300 秒。在最后 10% 的时间窗口（最多 30 秒）返回已有完整 HTML，通过 `waitUntil` 刷新；不扩大原有内容存留期限。完全过期或新 build 首次访问仍同步渲染。
- 同一 isolate、同一缓存命名空间和 key 的刷新只启动一次，直到缓存写入完成后才释放。请求之间不传递 Response 流，也不让普通命中请求等待另一请求的刷新。不同 isolate/数据中心及完全冷缓存的并发未做全局合并。
- 缓存继续按原有路径、分页资格、语言、部署 namespace 和 build 规则隔离。失效 key 不变；同一 isolate 中显式失效会取消尚未发布的刷新，已开始的缓存写入完成后再删除，防止旧结果覆盖失效操作。
- 后台结果必须是 200 HTML，且不能携带 Set-Cookie、private/no-store 或错误状态覆盖标记；详情还必须重新返回既有公开缓存标记。失败仅保留旧条目剩余有效期。私有/未列出详情继续经过现有可见性与鉴权判断，`__data.json` 不进入 HTML 缓存。
- 增加 `Server-Timing: ssr_cache` 与 `ssr_render`，区分复用结果和执行 SSR。接近过期的响应标为 `X-Cache: STALE`，不再交给外层 CDN 重新保存一整段新鲜期。HTML 始终保持流式读取/写入，没有额外在 JavaScript 中解码整页。

实现使用 Cache API 自行维护刷新窗口；[Cloudflare 文档](https://developers.cloudflare.com/workers/runtime-apis/cache/)明确说明 `cache.put`/`cache.match` 不原生实现 stale-while-revalidate。

追加实验仍使用上述隔离 workerd 和 Chrome 配置，每项 3 次新上下文。基线是首轮优化后的工作区，触屏 `tap` 没有桌面 hover；滚动到链接后停留 500 ms，再测 touchstart 到目标 DOM 更新及两帧。

| 首页直接点击 | 追加优化前中位数 | 追加优化后中位数 |
| --- | ---: | ---: |
| Trending | 362 ms | 213 ms |
| Recent | 393 ms | 213 ms |
| Top | 361 ms | 229 ms |
| 公开技能详情 | 417 ms | 244 ms |

12 次追加样本点击前的页面数据请求均为 0；点击后每次 1 个 SvelteKit data 请求。代价是可见入口会在空闲浏览期间提前加载约 79–81 KB 解压后的静态 JS，可复用于后续访问；这是主动预加载量，不能与首轮“首屏 JS”口径直接比较。

隔离 Worker 实际观察到首页 `MISS → HIT → STALE → HIT`，以及榜单、分类、详情 `MISS → HIT`；命中保留完整正文、卡片和语言，`ssr_cache` 样本为 1–2 ms。该数字是本地缓存查询墙钟时间，不是生产计费 CPU 或全请求时延；实际生产 CPU、命中率和跨区域效果尚未测量。

追加后 132 个 Web 测试文件、969 项测试通过，typecheck、lint、生产构建通过。新增测试覆盖刷新合并、namespace 隔离、刷新失败重试、失效/写入竞争、build/TTL、错误/私有/带 Cookie 响应及导航数据边界。浏览器 8 项交互回归和 17 项 SSR/错误页/平板检查再次通过；两种 Save-Data 模式均通过。一次语言测试在整页导航尚未 hydration 时过早操作，改为等待页面就绪后重新运行全部交互检查通过。

原始追加样本和检查结果见 [10 月 23 日证据](performance-optimization-evidence-2026-10-23.json)。此阶段尚未提交、推送或部署；后续发布结果单独记录。
