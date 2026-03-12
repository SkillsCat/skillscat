<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import DocsTableOfContents from '$lib/components/docs/DocsTableOfContents.svelte';
  import { getDocsCopy } from '$lib/i18n/docs';
  import { useI18n } from '$lib/i18n/runtime';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  const i18n = useI18n();
  const docsCopy = $derived(getDocsCopy(i18n.locale()));
  const commonCopy = $derived(docsCopy.common);
  const pageCopy = $derived(docsCopy.cli);
  const title = $derived(pageCopy.title);
  const description = $derived(pageCopy.description);
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs-cli' });

  const toc = [
    { id: 'quick-start', label: '快速开始' },
    { id: 'search-and-inspect', label: '搜索与检查' },
    { id: 'install-skills', label: '安装 skill' },
    { id: 'manage-installs', label: '管理已安装内容' },
    { id: 'auth-and-config', label: '登录与配置' },
    { id: 'publish-and-submit', label: '发布与收录' },
    { id: 'command-reference', label: '命令速查' },
  ] as const;

  const commandRows = [
    {
      command: 'npx skillscat search "code review"',
      purpose: '按任务搜索 SkillsCat registry 里的公开 skill。',
    },
    {
      command: 'npx skillscat info owner/repo',
      purpose: '先看一个仓库里到底有哪些 skill，再决定装哪一个。',
    },
    {
      command: 'npx skillscat add owner/repo',
      purpose: '把默认 skill bundle 装到当前项目。',
    },
    {
      command: 'npx skillscat add owner/repo --skill "skill-name"',
      purpose: '从多 skill 仓库里只装一个指定 skill。',
    },
    {
      command: 'npx skillscat update --check',
      purpose: '只检查更新，不直接覆盖本地安装。',
    },
    {
      command: 'npx skillscat login',
      purpose: '登录 SkillsCat，用于 private skill、发布和写操作。',
    },
    {
      command: 'npx skillscat publish ./path/to/skill',
      purpose: '发布你自己的 skill bundle。',
    },
  ] as const;

  const structuredData = $derived([
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description,
      url: `${SITE_URL}/docs/cli`,
      keywords: [
        'skillscat cli',
        'skillscat install',
        'skillscat search',
        'skillscat publish',
      ],
      author: {
        '@type': 'Organization',
        name: 'SkillsCat',
      },
      publisher: {
        '@type': 'Organization',
        name: 'SkillsCat',
        url: SITE_URL,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: commonCopy.docsBreadcrumb,
          item: `${SITE_URL}/docs`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: pageCopy.breadcrumb,
          item: `${SITE_URL}/docs/cli`,
        },
      ],
    },
  ]);
</script>

<SEO
  {title}
  {description}
  url="/docs/cli"
  image={ogImageUrl}
  imageAlt={pageCopy.imageAlt}
  keywords={[
    'skillscat cli',
    'skillscat docs',
    'skillscat install command',
    'skillscat search',
    'skillscat publish',
  ]}
  type="article"
  section="Documentation"
  tags={['CLI', 'SkillsCat', 'Install Guide']}
  structuredData={structuredData}
/>

<div class="docs-page">
  <div class="docs-shell">
    <section class="card docs-hero">
      <div class="docs-hero-copy">
        <div class="docs-hero-meta">
          <a href="/docs" class="docs-back-link" aria-label={commonCopy.backToDocsAriaLabel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path
                d="M15 18l-6-6 6-6"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </a>
          <p class="docs-eyebrow">{pageCopy.eyebrow}</p>
        </div>
        <h1>{pageCopy.heading}</h1>
        <p class="docs-summary">
          这页只讲 SkillsCat 自己的 CLI。它继续走原生 registry，不是给 <code>clawhub</code> CLI 兼容层用的。
        </p>
      </div>
    </section>

    <div class="docs-content-grid">
      <div class="docs-main">
        <DocsProseCard title="docs/cli.md">
          <p>
            SkillsCat CLI 的定位很直接: 把 AI agent skills 的搜索、安装、更新、发布收在同一套命令里。
            如果你只记一条原则，那就是先 <code>search</code> 或 <code>info</code>，确认来源和内容，再执行
            <code>add</code>。
          </p>
          <p>
            如果你现在手里用的是 OpenClaw 生态里的 <code>clawhub</code> CLI，而不是 <code>skillscat</code> CLI，
            直接跳到 <a href="/docs/openclaw">{commonCopy.links.openclawDocs}</a>。那一页讲的是 <code>/openclaw</code> 兼容接口。
          </p>

          <h2 id="quick-start">快速开始</h2>
          <p>第一次使用时，下面这组命令就足够覆盖大多数场景。</p>
          <pre><code>npx skillscat search "code review"
npx skillscat info owner/repo
npx skillscat add owner/repo
npx skillscat add owner/repo --skill "skill-name"
npx skillscat update --check
npx skillscat list</code></pre>

          <h2 id="search-and-inspect">搜索与检查</h2>
          <p>
            当你知道“要做什么”，但还不知道该装哪个 skill，就先搜。搜索支持自然语言任务词，适合从问题出发找 skill。
            如果你已经知道 GitHub 仓库，再用 <code>info</code> 看仓库里有哪些 skill、默认会装哪一个。
          </p>
          <pre><code>npx skillscat search "seo audit"
npx skillscat search "jira auth" --category devops
npx skillscat info owner/repo</code></pre>
          <ul>
            <li><code>search</code> 适合“我想做什么”。</li>
            <li><code>info</code> 适合“我已经知道仓库是谁，但不确定里面是什么”。</li>
            <li>遇到多 skill 仓库时，先看 <code>info</code>，再决定要不要加 <code>--skill</code>。</li>
          </ul>

          <h2 id="install-skills">安装 skill</h2>
          <p>
            <code>add</code> 是安装主命令。默认会装到当前项目里，这样 skill 和项目代码靠得更近，团队协作也更清楚。
            只有在你明确要跨项目复用时，再考虑 <code>--global</code>。
          </p>
          <pre><code>npx skillscat add owner/repo
npx skillscat add owner/repo --skill "skill-name"
npx skillscat add https://github.com/owner/repo
npx skillscat add owner/repo --list
npx skillscat add owner/repo --global
npx skillscat add owner/repo --agent openclaw</code></pre>
          <ul>
            <li><code>--skill</code> 只装一个指定 skill。</li>
            <li><code>--list</code> 只列出可安装项，不落盘。</li>
            <li><code>--yes</code> 跳过确认，适合脚本化流程。</li>
            <li><code>--force</code> 用于覆盖已有安装或继续处理风险场景。</li>
            <li>目标环境是 OpenClaw 时，直接加 <code>--agent openclaw</code>，目录结构会自动对齐。</li>
          </ul>

          <h2 id="manage-installs">管理已安装内容</h2>
          <p>
            装完之后，常用的是 <code>list</code>、<code>remove</code>、<code>update</code> 和
            <code>convert</code>。其中 <code>update --check</code> 很适合先看差异，再决定要不要覆盖。
          </p>
          <pre><code>npx skillscat list
npx skillscat remove skill-name
npx skillscat update --check
npx skillscat update
npx skillscat convert openclaw --from agents
npx skillscat self-upgrade</code></pre>
          <ul>
            <li><code>list</code> 先看当前项目或全局已经装了什么。</li>
            <li><code>remove</code> 按 skill 名称移除本地安装。</li>
            <li><code>update</code> 会优先走 registry 更新；<code>--check</code> 只做检查。</li>
            <li><code>convert</code> 用于把已有 <code>.agents</code> 内容迁到 OpenClaw 等目标目录。</li>
          </ul>

          <h2 id="auth-and-config">登录与配置</h2>
          <p>
            需要 private skill、发布、或者写操作时，再执行登录。日常公开安装不一定要登录，但建议你至少知道
            <code>whoami</code> 和 <code>config</code> 怎么用，排查问题会快很多。
          </p>
          <pre><code>npx skillscat login
npx skillscat whoami
npx skillscat logout
npx skillscat config list
npx skillscat config get registry
npx skillscat config set registry https://skills.cat/registry
npx skillscat config delete registry</code></pre>
          <ul>
            <li><code>login</code> 登录 SkillsCat。</li>
            <li><code>whoami</code> 检查当前账号或 token 是否生效。</li>
            <li><code>config set registry ...</code> 可以把 CLI 指到自定义 registry。</li>
            <li>如果你在 OpenClaw 生态里想走 ClawHub 兼容协议，直接看 <a href="/docs/openclaw">OpenClaw 文档</a>。</li>
          </ul>

          <h2 id="publish-and-submit">发布与收录</h2>
          <p>
            SkillsCat 有两条不同的入口: <code>publish</code> 是把本地 bundle 直接发布到 SkillsCat，
            <code>submit</code> 是把一个 GitHub 仓库提交给 SkillsCat 去索引。已经发布的 private skill 如需移除，再用
            <code>unpublish</code>。
          </p>
          <pre><code>npx skillscat publish ./my-skill
npx skillscat publish ./my-skill --private
npx skillscat submit https://github.com/owner/repo
npx skillscat unpublish owner/my-skill</code></pre>
          <ul>
            <li><code>publish</code> 适合你已经整理好本地 skill bundle 的情况。</li>
            <li><code>submit</code> 适合公开 GitHub 仓库，希望 SkillsCat 帮你建立收录。</li>
            <li><code>unpublish</code> 只针对已发布的 private skill。</li>
          </ul>

          <h2 id="command-reference">命令速查</h2>
          <table>
            <thead>
              <tr>
                <th>命令</th>
                <th>什么时候用</th>
              </tr>
            </thead>
            <tbody>
              {#each commandRows as row}
                <tr>
                  <td><code>{row.command}</code></td>
                  <td>{row.purpose}</td>
                </tr>
              {/each}
            </tbody>
          </table>

          <blockquote>
            目标环境是 OpenClaw、ClawBot，或者你想把 OpenClaw 默认的 ClawHub registry 改成 SkillsCat，
            直接继续看 <a href="/docs/openclaw">{commonCopy.links.openclawGuide}</a>。
          </blockquote>
        </DocsProseCard>
      </div>

      <DocsTableOfContents items={toc} />
    </div>
  </div>
</div>

<style>
  .docs-page {
    padding: 1.5rem 1rem 4rem;
  }

  .docs-shell {
    max-width: 72rem;
    margin: 0 auto;
    display: grid;
    gap: 1.25rem;
  }

  .docs-hero {
    display: grid;
    gap: 1rem;
    padding: 2rem;
    border-radius: 1.75rem;
  }

  .docs-hero-copy {
    display: grid;
    gap: 0.85rem;
  }

  .docs-hero-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .docs-back-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border: 2px solid var(--border);
    border-radius: 999px;
    background: var(--bg-subtle);
    color: var(--fg);
    text-decoration: none;
    transition: transform 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .docs-back-link svg {
    width: 1rem;
    height: 1rem;
  }

  .docs-back-link:hover {
    transform: translateY(-1px);
    border-color: var(--primary);
    color: var(--primary);
  }

  .docs-eyebrow {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
  }

  h1 {
    margin: 0;
    color: var(--fg);
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 1.05;
  }

  .docs-summary {
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.7;
  }

  .docs-content-grid {
    display: grid;
    gap: 1.25rem;
  }

  .docs-main {
    min-width: 0;
  }

  @media (min-width: 900px) {
    .docs-page {
      padding: 2rem 1.5rem 4rem;
    }
  }

  @media (min-width: 1100px) {
    .docs-content-grid {
      grid-template-columns: minmax(0, 1fr) 18rem;
      align-items: start;
    }
  }
</style>
