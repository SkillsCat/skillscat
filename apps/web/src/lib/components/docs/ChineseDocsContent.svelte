<script lang="ts">
  let { kind }: { kind: 'index' | 'cli' | 'openclaw' } = $props();
</script>

{#if kind === 'index'}
  <p>SkillsCat 是面向 AI 智能体技能的 registry 和 CLI。先找到合适的技能，再把完整技能包安装到项目、OpenClaw 或团队环境中，无需手动拼凑文件。</p>

  <h2>SkillsCat 是什么</h2>
  <ul>
    <li>可搜索的 AI 智能体技能目录，帮助你根据任务发现技能，而不必只凭 GitHub 仓库名判断。</li>
    <li>安装完整技能包的 CLI，保留 <code>SKILL.md</code>、脚本、模板和参考资料之间的依赖关系。</li>
    <li>让 OpenClaw、ClawBot 和本地项目使用同一技能来源的入口。</li>
  </ul>

  <h2>可以用它做什么</h2>
  <ul>
    <li>通过<a href="/zh-CN/categories">分类</a>或搜索找到技能，阅读功能介绍、源文件和仓库来源，再决定是否安装。</li>
    <li>一起安装模板、脚本、配置和其他资源，保留作者提供的完整技能包。</li>
    <li>在同一工具链中完成安装、更新、认证、发布和 OpenClaw 接入。</li>
  </ul>
  <p>中文介绍帮助理解用途，原始 <code>SKILL.md</code> 保持作者使用的语言。介绍不替代源文件，也不会改变实际安装内容。近期收录表示内容首次进入 SkillsCat；趋势榜结合近期活动与安装信号，不等同于兼容性或安全保证。</p>

  <h2>从哪里开始</h2>
  <p>想了解搜索、安装和更新，请从 <a href="/zh-CN/docs/cli">CLI 文档</a>开始。如果你已经在使用 OpenClaw 或 ClawBot，或希望用 SkillsCat 替换默认 registry，请阅读 <a href="/zh-CN/docs/openclaw">OpenClaw 指南</a>。复制详情页的精确安装命令，并在自己的项目环境中验证结果。</p>
{:else if kind === 'cli'}
  <p>SkillsCat CLI 将 AI 智能体技能的搜索、安装、更新和发布集中在同一工具中。先运行 <code>search</code> 或 <code>info</code>，检查来源和内容，再通过 <code>add</code> 安装。</p>
  <p>如果你使用的是 OpenClaw 生态中的 <code>clawhub</code>，请阅读 <a href="/zh-CN/docs/openclaw">OpenClaw 文档</a>，了解 <code>/openclaw</code> 兼容接口与原生 registry 的区别。</p>

  <h2 id="quick-start">快速开始</h2>
  <p>在具备 Node.js 和 <code>npx</code> 的终端中，以下命令涵盖常见流程。将示例 slug 替换为技能详情页的实际值，不要根据仓库名猜测。</p>
  <pre><code>npx skillscat search "code review"
npx skillscat info owner/repo
npx skillscat add owner/my-skill
npx skillscat add owner/path/to/skill
npx skillscat update --check
npx skillscat list</code></pre>

  <h2 id="search-and-inspect">搜索与检查</h2>
  <p>知道任务但不知道具体技能时，使用自然语言搜索。已知 GitHub 仓库时，用 <code>info</code> 检查其中有哪些技能，以及默认会安装哪一个。</p>
  <pre><code>npx skillscat search "seo audit"
npx skillscat search "jira auth" --category devops
npx skillscat info owner/repo</code></pre>
  <ul>
    <li><code>search</code> 适合从任务或问题出发发现技能。</li>
    <li><code>info</code> 适合检查已知仓库的技能和目录结构。</li>
    <li>多技能仓库也应先检查，再按目标技能的精确发布 slug 安装。</li>
  </ul>

  <h2 id="install-skills">安装技能</h2>
  <p><code>add</code> 默认安装到当前项目。需要跨项目复用时再选择 <code>--global</code>。已发布技能优先使用精确 slug，嵌套路径和多技能仓库同样适用。</p>
  <pre><code>npx skillscat add owner/my-skill
npx skillscat add owner/path/to/skill
npx skillscat add https://github.com/owner/repo
npx skillscat add owner/my-skill --global
npx skillscat add owner/my-skill --agent openclaw
npx skillscat add owner/repo --list</code></pre>
  <ul>
    <li>只知道仓库时，先运行 <code>info</code> 或 <code>add owner/repo --list</code> 发现目标技能。</li>
    <li><code>--list</code> 预览可安装条目，不写入安装文件。</li>
    <li><code>--yes</code> 跳过确认提示，供脚本流程使用。</li>
    <li><code>--force</code> 用于覆盖已有安装或继续处理需要额外确认的状态。</li>
    <li><code>--agent openclaw</code> 会按 OpenClaw 的目录结构安装。</li>
  </ul>

  <h2 id="manage-installs">管理安装</h2>
  <p>安装后，通过 <code>list</code>、<code>remove</code>、<code>update</code> 和 <code>convert</code> 管理本地内容。先用 <code>update --check</code> 检查可用更新，并保存项目中的自定义修改，再决定是否更新。</p>
  <pre><code>npx skillscat list
npx skillscat remove skill-name
npx skillscat update --check
npx skillscat update
npx skillscat convert openclaw --from agents
npx skillscat self-upgrade</code></pre>
  <ul>
    <li><code>list</code> 查看当前项目或全局范围已安装的技能。</li>
    <li><code>remove</code> 按技能名删除本地安装。</li>
    <li><code>update</code> 优先使用 registry 更新；<code>--check</code> 只检查，不覆盖本地内容。</li>
    <li><code>convert</code> 将已有的 <code>.agents</code> 内容迁移到 OpenClaw 等目录结构。</li>
  </ul>

  <h2 id="auth-and-config">认证与配置</h2>
  <p>访问私有技能、发布内容或执行其他写入操作前，先完成登录。<code>whoami</code> 与 <code>config</code> 可以帮助检查当前账号和 registry 配置。</p>
  <pre><code>npx skillscat login
npx skillscat whoami
npx skillscat logout
npx skillscat config list
npx skillscat config get registry
npx skillscat config set registry https://skills.cat/registry
npx skillscat config delete registry</code></pre>
  <p><code>login</code> 通过浏览器完成设备登录，<code>whoami</code> 确认当前账号或令牌状态。原生 CLI 使用 <code>https://skills.cat/registry</code>；不要与 <a href="/zh-CN/docs/openclaw">OpenClaw 指南</a>中的 ClawHub 兼容入口混用。</p>

  <h2 id="publish-and-submit">发布与提交</h2>
  <p><code>publish</code> 上传本地技能包，<code>submit</code> 提交公开 GitHub 仓库供 SkillsCat 索引。<code>unpublish</code> 用于下架已发布的私有技能。发布前检查目录及引用资源，确保脚本和模板完整。</p>
  <pre><code>npx skillscat publish ./my-skill
npx skillscat publish ./my-skill --private
npx skillscat submit https://github.com/owner/repo
npx skillscat unpublish owner/my-skill</code></pre>

  <h2 id="command-reference">命令参考</h2>
  <table>
    <thead><tr><th>命令</th><th>使用场景</th></tr></thead>
    <tbody>
      <tr><td><code>npx skillscat search "code review"</code></td><td>按任务或问题搜索公开技能。</td></tr>
      <tr><td><code>npx skillscat info owner/repo</code></td><td>安装前检查仓库包含哪些技能。</td></tr>
      <tr><td><code>npx skillscat add owner/my-skill</code></td><td>按精确发布 slug 安装技能。</td></tr>
      <tr><td><code>npx skillscat add owner/path/to/skill</code></td><td>按嵌套路径 slug 安装已发布技能。</td></tr>
      <tr><td><code>npx skillscat update --check</code></td><td>检查更新，不覆盖当前安装。</td></tr>
      <tr><td><code>npx skillscat login</code></td><td>登录以访问私有技能、发布或执行写入操作。</td></tr>
      <tr><td><code>npx skillscat publish ./path/to/skill</code></td><td>发布本地技能包。</td></tr>
    </tbody>
  </table>
  <p>使用 <code>npx skillscat --help</code> 或 <code>npx skillscat publish --help</code> 查看当前版本的命令与选项。</p>
  <blockquote>目标环境为 OpenClaw 或 ClawBot，或需要替换默认 ClawHub registry 时，请继续阅读 <a href="/zh-CN/docs/openclaw">OpenClaw 指南</a>。</blockquote>
{:else}
  <p>这里有两种接入方式：<code>clawhub</code> 使用 <code>https://skills.cat/openclaw</code> 兼容入口；原生 <code>skillscat</code> CLI 继续使用主 registry <code>/registry</code>，无需切换到兼容层。</p>

  <h2 id="auto-install">兼容模式安装</h2>
  <p>保留 OpenClaw 或 ClawHub 工作流时，将 <code>site</code> 和 <code>registry</code> 配置为 SkillsCat。搜索、安装、更新、检查和发布将通过 <code>/openclaw</code> 兼容接口完成。</p>
  <pre><code>clawhub search "seo audit" --site https://skills.cat --registry https://skills.cat/openclaw
clawhub inspect &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub install &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub update &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub publish ./my-skill --slug &lt;owner&gt;~&lt;skill&gt; --version 1.0.0 --site https://skills.cat --registry https://skills.cat/openclaw</code></pre>
  <ul>
    <li>ClawHub 兼容 slug 使用 <code>~</code>，例如 <code>owner~skill</code> 或 <code>owner~path~to~skill</code>。发布时也使用这个格式。</li>
    <li>客户端可通过 <code>https://skills.cat/.well-known/clawhub.json</code> 自动发现兼容 API。</li>
    <li>兼容接口位于 <code>/openclaw</code>，原生 SkillsCat CLI 的 registry 位于 <code>/registry</code>。</li>
  </ul>

  <h2 id="host-cli-install">原生 CLI 安装</h2>
  <p>也可以在 OpenClaw 工作区直接使用 SkillsCat CLI。它通过原生 registry 安装完整技能包，<code>--agent openclaw</code> 负责选择对应目录结构。</p>
  <pre><code>npx skillscat info &lt;owner&gt;/&lt;repo&gt;
npx skillscat add &lt;slug&gt; --agent openclaw
npx skillscat add &lt;slug&gt; --agent openclaw --global
npx skillscat convert openclaw --from agents</code></pre>
  <p>将 <code>&lt;slug&gt;</code> 替换为详情页的精确值，例如 <code>owner/my-skill</code> 或 <code>owner/path/to/skill</code>。只知道仓库时先用 <code>info</code> 检查。<code>convert openclaw --from agents</code> 可用于迁移已有的 <code>.agents</code> 内容。</p>

  <h2 id="registry-override">配置站点与 registry</h2>
  <p>将 SkillsCat 作为 ClawHub 默认来源时，可以设置环境变量，避免每次重复输入参数。</p>
  <pre><code>export CLAWHUB_SITE=https://skills.cat
export CLAWHUB_REGISTRY=https://skills.cat/openclaw

clawhub search "calendar"
clawhub install &lt;owner&gt;~&lt;skill&gt;
clawhub update &lt;owner&gt;~&lt;skill&gt;</code></pre>
  <p>临时覆盖可直接在单条命令中使用 <code>--site</code> 和 <code>--registry</code>。站点指向根地址，兼容 registry 指向 <code>/openclaw</code>；原生 SkillsCat CLI 不需要这组配置。</p>

  <h2 id="paths-and-layout">目录与技能包结构</h2>
  <p>两种接入方式都应保留完整技能包，不能只复制 <code>SKILL.md</code>，或省略模板、脚本、JSON、YAML 等资源。</p>
  <table>
    <thead><tr><th>范围</th><th>目录</th><th>使用场景</th></tr></thead>
    <tbody>
      <tr><td>项目安装</td><td><code>&lt;workspace&gt;/skills/&lt;folder-name&gt;/</code></td><td>推荐默认方式，让技能随项目管理，方便协作和版本控制。</td></tr>
      <tr><td>全局安装</td><td><code>~/.openclaw/skills/&lt;folder-name&gt;/</code></td><td>用于个人跨项目复用。</td></tr>
    </tbody>
  </table>
  <p>同时存在项目与全局安装时，先检查当前工作区的 <code>skills/</code>。确认 <code>SKILL.md</code> 和附带资源完整，再按当前 OpenClaw 版本刷新技能，或开启新会话。</p>

  <h2 id="private-skills">私有技能与令牌</h2>
  <p>访问私有技能或执行写入操作前，先确认正在使用哪种 CLI。<code>clawhub</code> 浏览器登录获取 SkillsCat 兼容令牌，<code>skillscat</code> 则使用自己的原生认证流程。</p>
  <pre><code>clawhub login --site https://skills.cat
clawhub login --token &lt;skillscat-api-token&gt; --site https://skills.cat --registry https://skills.cat/openclaw
npx skillscat login
npx skillscat add &lt;slug&gt; --agent openclaw</code></pre>
  <ul>
    <li><code>clawhub login --site https://skills.cat</code> 打开兼容认证页面，并将 registry 设为 <code>/openclaw</code>。</li>
    <li>手动令牌可在 <a href="/user/tokens">API 令牌</a>页创建；按操作需要配置 <code>read</code>、<code>write</code> 和 <code>publish</code> 权限。</li>
    <li>兼容层支持已认证搜索与已知 slug 安装。更复杂的私有技能浏览、仓库选择与管理请使用原生 CLI。</li>
    <li><code>skillscat login</code> 只影响 SkillsCat CLI，不会重写 ClawHub 的 registry 配置。</li>
  </ul>

  <h2 id="troubleshooting">问题排查</h2>
  <ul>
    <li>技能未生效时，检查当前工作区、安装目录、<code>SKILL.md</code> 文件名与包内相对路径，然后开启新的 OpenClaw 会话。</li>
    <li>多技能仓库选错目标时，先运行 <code>npx skillscat info owner/repo</code>，再按精确 slug 安装。</li>
    <li>只需安装到 OpenClaw 时，优先使用 <code>npx skillscat add &lt;slug&gt; --agent openclaw</code>。</li>
    <li>下载或权限异常时，核对技能可见性、令牌权限以及所用 CLI。</li>
  </ul>
  <p>技能运行仍依赖源文件说明的命令、凭据或外部工具；安装成功不会自动配置这些依赖。</p>
  <blockquote>原生 CLI 的完整命令说明见 <a href="/zh-CN/docs/cli">CLI 文档</a>。本指南主要说明 ClawHub 兼容层和 OpenClaw 安装目录。</blockquote>
{/if}
