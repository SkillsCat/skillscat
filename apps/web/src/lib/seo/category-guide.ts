import { CATEGORY_SECTIONS } from '$lib/constants/categories';

const guidance: Record<string, [string, string]> = {
  "development": [
    "Use these skills to move from a reproducible issue or change request to a reviewable patch. Match the language, framework and test runner to your repository; compare the proposed diff and run your own checks before accepting edits.",
    "这类技能帮助你把可复现的问题或变更需求转化为可审查的代码修改。选择时核对语言、框架和测试工具是否匹配项目；采用修改前，检查差异并运行项目自身的验证。"
  ],
  "backend": [
    "Use these skills when designing service interfaces, changing data models or integrating identity and cache layers. Check the supported database or provider, migration behavior and required credentials before choosing a workflow.",
    "这类技能适用于服务接口设计、数据模型变更，以及身份认证和缓存集成。选择时检查支持的数据库或服务商、迁移行为和凭证要求，优先选用能在测试环境验证的工作流。"
  ],
  "frontend": [
    "Use these skills to build and refine interfaces. Compare framework support, keyboard interaction and responsive behavior; test generated components with real content at both narrow and wide viewport sizes.",
    "这类技能用于界面实现与体验改进。比较框架支持、键盘交互和响应式行为；生成组件后，使用真实内容分别检查窄屏与宽屏布局。"
  ],
  "devops": [
    "Use these skills to automate builds, delivery and infrastructure maintenance. Read which commands change remote resources, check provider compatibility and review rollback steps before running a deployment workflow.",
    "这类技能用于构建、交付和基础设施维护。使用前确认哪些命令会修改远程资源、是否兼容当前云平台，以及是否提供可执行的回滚步骤。"
  ],
  "quality": [
    "Use these skills to examine correctness, security and runtime behavior. Prefer a workflow that explains its findings and produces reproducible checks; compare results against your project conventions and measured baselines.",
    "这类技能用于检查正确性、安全性和运行表现。优先选择能够说明判断依据并提供可复现验证的工作流，再将结果与项目约定及实际测量基线对照。"
  ],
  "docs": [
    "Use these skills to document behavior and maintain explanations alongside code. Check which source files the workflow reads, whether examples are executable and how it keeps terminology consistent across languages.",
    "这类技能帮助你记录系统行为并让说明与代码保持一致。选择时检查它读取哪些源文件、示例是否可运行，以及多语言文档如何保持术语一致。"
  ],
  "data": [
    "Use these skills to collect, transform and examine datasets. Compare supported formats, data volume and handling of missing values; inspect a small sample before applying a transformation to the complete dataset.",
    "这类技能适用于数据采集、转换和分析。比较支持的格式、数据量与缺失值处理方式；先检查小样本结果，再对完整数据集执行转换。"
  ],
  "ai": [
    "Use these skills to connect model capabilities with repeatable agent workflows. Check the model or tool requirements, context inputs and evaluation examples; choose the smallest workflow that covers your actual task.",
    "这类技能帮助你把模型能力接入可重复的 agent 工作流。选择时核对模型或工具要求、上下文输入和评估示例，优先采用能够覆盖实际任务的简单流程。"
  ],
  "productivity": [
    "Use these skills to make recurring tasks repeatable, from file organization to command-line workflows. Compare required tools, the files they modify and whether a preview or dry run is available before applying changes.",
    "这类技能将文件整理、命令行操作等重复任务整理为可复用流程。选择时比较依赖工具、会修改的文件，以及是否支持预览或试运行。"
  ],
  "content": [
    "Use these skills to turn source material into drafts, edits or publishing assets. Check the intended audience and output format, then verify factual claims and adapt the result to your own voice before publishing.",
    "这类技能用于将素材转化为草稿、编辑结果或发布内容。选择时明确目标读者和输出格式，发布前核对事实并调整为自己的表达风格。"
  ],
  "lifestyle": [
    "Use these skills to structure research, learning and domain-specific tasks. Read the source instructions for the intended scope, required inputs and cited references; verify specialist conclusions against primary sources.",
    "这类技能帮助你组织研究、学习及领域任务。阅读源文件，确认适用范围、所需输入和参考依据；专业结论应结合一手资料核对。"
  ]
};

export function categoryGuide(slug: string, chinese: boolean) {
  const section = CATEGORY_SECTIONS.find((item) => item.categories.some((category) => category.slug === slug));
  return {
    text: section ? guidance[section.id]?.[chinese ? 1 : 0] : undefined,
    related: section?.categories.filter((category) => category.slug !== slug).slice(0, 4) ?? [],
  };
}
