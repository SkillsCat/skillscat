# TypeSafe Jev 分类与安全打标

这两个 Worker 使用原生 `POST https://api.typesafe.ai/v1/systemone`，通过 Cloudflare
Workers 的 `fetch` 调用，不需要 Node SDK。接入遵循
[TypeSafe skill](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md)、
[HTTP API](https://docs.typesafe.ai/api.md)、[Noul](https://docs.typesafe.ai/primitives/noul.md)、
[Score](https://docs.typesafe.ai/primitives/score.md) 和
[guardrails cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails.md)。

## 配置

| 配置 | 用途 |
| --- | --- |
| `TYPESAFE_API_KEY` | 可选的服务端 secret；在 classification 和 security-analysis 两个 Worker 上分别配置 |
| `TYPESAFE_MODEL` | 默认 `jev-1.13.0`，固定版本便于比较打标结果；可以显式覆盖 |
| `OPENROUTER_API_KEY` | 常规任务优先使用免费模型；也用于 premium 多轮安全复核及摘要生成 |

本地使用 `.dev.vars`；Worker 示例配置包含基础环境和 production 的模型变量。
初始化脚本支持读取或询问 TypeSafe key，并仅为上述两个 Worker 配置此 secret；已有
Cloudflare secrets 沿用原有保留逻辑。部署脚本按配置发现 Worker，不维护 secret 清单，
因此无需新增部署分支。生产 secret 设置及部署须按 AGENTS.md 取得单独授权。
留空 TypeSafe key 即跳过 Jev 回退。不要把 key 放进浏览器代码、普通 vars 或版本库。

## 路由与打标含义

- 分类保留 frontmatter 直接匹配及 hot-worthiness 门槛。需要 AI 的任务先调用 OpenRouter
  免费候选池，保留首个免费模型的一次重试。免费结果有效即返回，不调用 Jev。
  免费候选失败、限流或冷却中时才尝试 Jev；Jev 也无法判断后，使用已有的付费分类模型，
  最后回退关键词。仅 `openrouter/free` 或 `:free` 模型视为免费。
- Jev 分类回退批量询问所有现有类别的独立 Noul：是否为主要或实质能力。选择概率至少
  0.8 的类别，按概率排序，最多三个。Noul 是标签成立的概率，不是类别强度，也没有独立
  confidence 字段。无足够把握的匹配则继续回退。
- 常规安全任务优先使用 OpenRouter 免费模型的现有多阶段复核。只有免费链路不可用时才
  尝试 Jev，不因配置中存在 TypeSafe key 就增加调用。历史配置在免费候选池中的付费 ID
  只作为 Jev 之后的兼容回退，不能排在实际免费模型之前。
- Jev 安全回退保留现有 eligibility、文件选择及输入上限，按每份可读文件的五个维度
  批量询问 Score：prompt injection、隐私外传、危险操作、供应链恶意行为、混淆逃逸；
  二进制及仅有元数据的文件不送作可读内容，也不凭其存在判恶意。
- Score 的五档 rubric 对应应用分值 `[0, 2, 5, 8, 10]`，由各档概率加权映射，而非把
  yes/no 概率当严重程度。文件之间各维度取最高分，再进入既有 heuristic 合并和总分算法。
  任一使用的 Score confidence 小于 0.8 时整次回退，避免把不确定的低分当安全结论。
- premium 仍使用原有 OpenRouter 多轮复核。Jev 不生成解释、摘要或新类别；用户可见安全
  reason 是代码生成的 rubric 标签，不是具体命令或证据摘录。摘要和本地化继续走原有生成流程。
- 安全结果通过现有扫描表写入 `provider=typesafe`、响应实际模型版本及 input/output token
  usage。API 未返回费用，因此不伪造费用数值。相同内容的既有扫描仍会复用；启用不会自动
  重扫存量记录。分类沿用 `ai` 方法和原有类别缓存失效/搜索及推荐 dirty 标记。

## 成本与异常处理

免费模型成功时 Jev 请求数为零。免费链路不可用时，每个合格任务最多一个 Jev HTTP
请求，同一次请求的独立问题并行求值。15 秒超时；HTTP
429/529 将 Retry-After（至少 60 秒）写入现有 KV 的独立、按模型区分的冷却键
`typesafe:v1:paused_until:<model>`，后续任务在冷却期直接回退。不会立即反复请求 TypeSafe，
也不与 OpenRouter 的免费额度冷却混用。免费模型限流即记录共享冷却，即使随后 Jev 成功
也保留该冷却。OpenRouter 已暂停时跳过免费请求并尝试 Jev；Jev 不可用后遵守原有
OpenRouter 延后机制，不借冷却期触发付费兼容候选。
仅配置 Jev 或其他回退也失败时，Jev 的限流同样使安全任务保持 dirty 并延后到
冷却结束，不会把限流期间的临时启发式判断保存为已完成扫描。

请求以完整 UTF-8 字节数保守限制：state 加最长问题最多 30,000 bytes，总请求最多 60,000
bytes，为文档规定的 32k/64k token 上限留余量。超限直接回退，不静默裁剪证据；大量文件
或长文本因此可能较常使用原链路。校验每个答案的类型、概率、分布完整性及 token usage，
畸形或缺失结果不可作为安全低风险结论。错误日志不包含供应商返回的原始内容。
API 的 score 和各档概率可能分别舍入到两位小数，分布校验按档数允许累计舍入误差；映射
应用风险分时归一化舍入后的概率和，避免概率和略偏离 1 导致分值失真。

无需 migration、新 D1 查询、R2 衍生对象、新队列或前台公共缓存。每个实际 Jev 尝试增加
一次 KV 冷却读取；仅限流时写冷却。文件继续复用已有 R2 读取。免费额度耗尽或失败仍可能产生 Jev 输入费用，
需观测真实流量中的回退比例；本次没有新增存量重扫或额外线上测试调用。

## 验证范围

本地测试核对免费成功时零 Jev 调用、免费失败后供应商顺序及限流冷却，另覆盖 HTTP 合约、缺 key、畸形答案、限流、超时、输入上限、多标签、按文件评分、
不确定性回退、premium 隔离、OpenRouter 冷却，以及隔离 SQLite/R2 mock 下的队列写入
和重复内容复用。测试不调用付费服务，不读取或写入生产业务数据。

这些测试验证代码行为，不能证明 Jev 在 SkillsCat 数据上的准确率。0.8 阈值是初始策略，
尚需在独立标注集上验证：正常文档与引用示例、只带提示注入措辞的文件、实际秘密外传、
破坏性操作、多文件关联、缺失/二进制内容、多标签及无匹配情况，并覆盖中英文。固定模型
版本有助于复现；切换模型或 rubric 后重新评估误报、漏报、回退比例、实际 token 和延迟。
生产启用及上线验收遵循 AGENTS.md，不能用自动化合约测试代替模型质量或线上验收。

### 2026-09-19 真实 API 冒烟验证

在本地加载服务端 key，用合成文本直连 Jev，未使用生产 D1/R2/KV/Queue 或业务记录。
共 5 个请求均返回 HTTP 200、模型 `jev-1.13.0`，观测请求耗时约 399–1086 ms。

| 合成场景 | 结果 |
| --- | --- |
| 英文 Vitest 单元测试生成 | `testing` 0.98、`code-generation` 0.94，接受这两个标签 |
| 中文 WCAG 无障碍审查 | `accessibility` 0.98，接受该标签 |
| 正常 Markdown 格式建议 | 五维零风险、confidence 1，接受评估 |
| 指示执行脚本并外传 SSH 私钥的两文件样例 | 脚本文件风险判断高，但说明文件多维 confidence 不足，整次进入现有回退 |

首次恶意样例请求暴露了独立舍入导致的分布校验误拒绝；已修正累计舍入容差和应用分值
归一化，并用捕获响应离线回放及一个新增真实请求确认能解析并正确回退。回退下游本轮
仅使用自动化 mock 验证，未额外调用 OpenRouter。这些样例证明凭据和调用路径可用，
不能代表标注集准确率、生产可用性或已经完成阈值校准。
