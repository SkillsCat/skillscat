<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  let { kind }: { kind: 'index' | 'cli' | 'openclaw' } = $props();
  const title = $derived(kind === 'index' ? 'SkillsCat 使用文档' : kind === 'cli' ? 'SkillsCat CLI 使用指南' : '在 OpenClaw 中安装和使用技能');
  const description = $derived(kind === 'index'
    ? '了解如何通过 SkillsCat 发现 AI 智能体技能，检查来源，使用 CLI 安装完整技能包，并接入 OpenClaw。'
    : kind === 'cli' ? 'SkillsCat CLI 中文指南：按任务搜索技能、检查仓库、通过精确 slug 安装、检查更新及登录发布。'
      : '通过 SkillsCat CLI 向 OpenClaw 安装完整技能包，了解项目目录、兼容 registry、私有技能和常见排查方法。');
</script>

<SEO {title} {description} url={kind === 'index' ? '/docs' : `/docs/${kind}`} />
<article class="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6 leading-relaxed">
  <nav aria-label="文档导航" class="flex flex-wrap gap-4 text-primary">
    <a href="/zh-CN">首页</a><a href="/zh-CN/docs">文档</a>
    <a href="/zh-CN/docs/cli">CLI 指南</a><a href="/zh-CN/docs/openclaw">OpenClaw 指南</a>
  </nav>
  <h1 class="text-3xl font-extrabold">{title}</h1>
  <p>{description}</p>
  {#if kind === 'index'}
    <h2 class="text-xl font-bold">从任务出发选择技能</h2>
    <p>SkillsCat 收集用于 AI 智能体的技能。技能通常包含描述用途和操作步骤的 SKILL.md，也可能附带脚本、参考资料和模板。安装完整技能包可以保留这些文件之间的依赖关系。</p>
    <p>先根据要完成的任务浏览分类，再阅读详情中的功能介绍、源文件和仓库来源。近期收录表示内容首次进入 SkillsCat；趋势榜结合近期活动与安装信号，不等同于兼容性或安全保证。</p>
    <h2 class="text-xl font-bold">阅读、检查与安装</h2>
    <ol class="list-decimal pl-6 space-y-2">
      <li>通过<a class="text-primary" href="/zh-CN/categories">分类</a>或搜索找到技能，核对适用场景和所需工具。</li>
      <li>检查 SKILL.md、附带脚本以及来源仓库，确认技能所需的文件、网络和运行环境。</li>
      <li>复制详情页的精确安装命令。已发布的技能默认按 slug 安装，多技能仓库及嵌套路径同样适用。</li>
      <li>在自己的项目环境验证结果，之后通过 CLI 检查可用更新。</li>
    </ol>
    <p>中文介绍帮助理解用途，原始 SKILL.md 保持作者使用的语言。介绍不替代源文件，也不会改变实际安装内容。</p>
  {:else if kind === 'cli'}
    <h2 class="text-xl font-bold">搜索与检查</h2>
    <p>在具备 Node.js 和 npx 的终端中执行以下命令。搜索语句可以描述任务；仓库检查用于了解一个仓库包含哪些技能。</p>
    <pre class="overflow-x-auto p-4 bg-bg-subtle rounded-lg"><code>npx skillscat search "code review"
npx skillscat info owner/repo
npx skillscat add owner/repo --list</code></pre>
    <h2 class="text-xl font-bold">按已发布 slug 安装</h2>
    <p>从详情页复制实际 slug，替换下例中的 owner/my-skill。slug 是精确的技能标识，不应根据仓库名称猜测；多技能仓库的每个已发布技能也有自己的 slug。</p>
    <pre class="overflow-x-auto p-4 bg-bg-subtle rounded-lg"><code>npx skillscat add owner/my-skill
npx skillscat update --check</code></pre>
    <p>安装时根据 CLI 提示选择目标 agent 和安装范围。先检查更新，再决定是否更新本地内容；项目中的自定义修改应妥善保留。</p>
    <h2 class="text-xl font-bold">登录和发布</h2>
    <p>需要访问自己的私有技能或发布内容时，先通过浏览器完成设备登录。发布前检查技能目录及其引用资源，避免缺少脚本或模板。</p>
    <pre class="overflow-x-auto p-4 bg-bg-subtle rounded-lg"><code>npx skillscat login
npx skillscat whoami
npx skillscat publish --help</code></pre>
    <p>使用 <code>npx skillscat --help</code> 查看当前版本的命令。仓库发现和已发布 slug 安装是两个入口；详情页给出的安装命令应作为首选。</p>
  {:else}
    <h2 class="text-xl font-bold">通过 SkillsCat CLI 安装</h2>
    <p>在 OpenClaw 工作区执行安装命令，并将示例 slug 替换为详情页上的实际值。指定 agent 后，CLI 会按 OpenClaw 的技能目录结构安装完整包。</p>
    <pre class="overflow-x-auto p-4 bg-bg-subtle rounded-lg"><code>npx skillscat add owner/my-skill --agent openclaw</code></pre>
    <h2 class="text-xl font-bold">项目目录与全局目录</h2>
    <p>项目安装通常位于工作区的 <code>skills/</code> 目录，全局技能位于 <code>~/.openclaw/skills/</code>。团队项目优先使用项目范围，让技能随项目管理。安装后检查目录中的 SKILL.md 及附带资源是否完整，再按当前 OpenClaw 版本的方式刷新技能或重启会话。</p>
    <h2 class="text-xl font-bold">使用兼容 registry</h2>
    <p>已有 clawhub CLI 工作流可使用 SkillsCat 的 ClawHub 兼容入口：站点为 <code>https://skills.cat</code>，registry 为 <code>https://skills.cat/openclaw</code>。它与原生 SkillsCat CLI 的配置不同，接入前应核对所用客户端的 registry 配置方式。</p>
    <h2 class="text-xl font-bold">权限与排查</h2>
    <p>安装私有技能需要有效登录或相应授权。若技能未被识别，依次检查安装目录、SKILL.md 文件名、包内相对路径、当前工作区与会话刷新状态。若下载失败，核对精确 slug、技能可见性以及账号权限。</p>
    <p>技能的实际运行仍依赖源文件说明的命令、凭据或外部工具；安装成功本身不会替你配置这些依赖。</p>
  {/if}
</article>
