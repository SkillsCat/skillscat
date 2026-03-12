<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import DocsTableOfContents from '$lib/components/docs/DocsTableOfContents.svelte';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  const title = 'SkillsCat OpenClaw Documentation';
  const description =
    'Use SkillsCat with OpenClaw through the native SkillsCat CLI or the ClawHub-compatible /openclaw registry endpoint for clawhub CLI.';
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs-openclaw' });

  const toc = [
    { id: 'auto-install', label: '让 OpenClaw 自动安装' },
    { id: 'host-cli-install', label: '在主机上用 CLI 安装' },
    { id: 'registry-override', label: '替换 site / registry' },
    { id: 'paths-and-layout', label: '目录与 bundle 规则' },
    { id: 'private-skills', label: 'private skill 与 token' },
    { id: 'troubleshooting', label: '排查问题' },
  ] as const;

  const installTargets = [
    {
      target: '项目内安装',
      path: '<workspace>/skills/<folder-name>/',
      usage: '推荐默认选项。skill 跟项目一起走，团队协作和版本管理都更清楚。',
    },
    {
      target: '全局安装',
      path: '~/.openclaw/skills/<folder-name>/',
      usage: '只给你个人长期复用的通用 skill 用，不适合项目绑定型 workflow。',
    },
  ] as const;

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: title,
      description,
      url: `${SITE_URL}/docs/openclaw`,
      step: [
        {
          '@type': 'HowToStep',
          name: 'Point OpenClaw or ClawHub to SkillsCat',
          text: 'Set the site to https://skills.cat and the registry to https://skills.cat/openclaw so clawhub CLI uses the compatibility layer instead of the native SkillsCat registry.',
        },
        {
          '@type': 'HowToStep',
          name: 'Search or inspect the skill',
          text: 'Use clawhub search or the SkillsCat CLI to confirm the skill you want to install.',
        },
        {
          '@type': 'HowToStep',
          name: 'Install into the OpenClaw layout',
          text: 'Install with clawhub install or npx skillscat add --agent openclaw so the bundle lands in the correct skills directory.',
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Docs',
          item: `${SITE_URL}/docs`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'OpenClaw',
          item: `${SITE_URL}/docs/openclaw`,
        },
      ],
    },
  ];
</script>

<SEO
  {title}
  {description}
  url="/docs/openclaw"
  image={ogImageUrl}
  imageAlt="SkillsCat OpenClaw documentation preview"
  keywords={[
    'openclaw skills',
    'openclaw docs',
    'skillscat openclaw',
    'openclaw install guide',
    'clawbot skills',
    'skillscat clawhub',
  ]}
  type="article"
  section="Documentation"
  tags={['OpenClaw', 'ClawBot', 'SkillsCat']}
  structuredData={structuredData}
/>

<div class="docs-page">
  <div class="docs-shell">
    <section class="card docs-hero">
      <div class="docs-hero-copy">
        <div class="docs-hero-meta">
          <a href="/docs" class="docs-back-link" aria-label="Back to docs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path
                d="M15 18l-6-6 6-6"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </a>
          <p class="docs-eyebrow">OpenClaw Guide</p>
        </div>
        <h1>Use SkillsCat inside OpenClaw</h1>
        <p class="docs-summary">
          这页明确区分两套 CLI: <code>clawhub</code> CLI 走 <code>/openclaw</code> 兼容层，
          <code>skillscat</code> CLI 继续走 SkillsCat 原生 registry。
        </p>
      </div>
    </section>

    <div class="docs-content-grid">
      <div class="docs-main">
        <DocsProseCard title="docs/openclaw.md">
          <p>
            这页有两条路: 如果你在用的是 <code>clawhub</code> CLI，就让它走
            <code>https://skills.cat/openclaw</code> 这套兼容接口；如果你用的是我们自己的
            <code>skillscat</code> CLI，那它还是走 SkillsCat 原生 <code>/registry</code>，
            不需要切到兼容层。
          </p>

          <h2 id="auto-install">让 OpenClaw 自动安装</h2>
          <p>
            想保留 OpenClaw / ClawHub 的使用习惯，可以直接把它的 <code>site</code> 和
            <code>registry</code> 指向 SkillsCat。这样后续的搜索、安装、更新、检查、发布都会走
            SkillsCat 的 <code>/openclaw</code> 兼容端口，而不是原生 registry。
          </p>
          <pre><code>clawhub search "seo audit" --site https://skills.cat --registry https://skills.cat/openclaw
clawhub inspect &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub install &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub update &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub publish ./my-skill --slug &lt;owner&gt;~&lt;skill&gt; --version 1.0.0 --site https://skills.cat --registry https://skills.cat/openclaw</code></pre>
          <ul>
            <li>SkillsCat 的 ClawHub 兼容 slug 用 <code>~</code> 连接层级，例如 <code>owner~skill</code> 或 <code>owner~path~to~skill</code>。</li>
            <li>客户端会通过 <code>https://skills.cat/.well-known/clawhub.json</code> 自动发现兼容 API。</li>
            <li><code>clawhub</code> CLI 兼容层固定在 <code>/openclaw</code>；<code>skillscat</code> CLI 仍然走原生 <code>/registry</code>。</li>
            <li>如果你要用 <code>clawhub publish</code>，slug 也要用兼容格式，例如 <code>owner~skill</code>。</li>
          </ul>

          <h2 id="host-cli-install">在主机上用 CLI 安装</h2>
          <p>
            如果你更在意安装结果可控、目录稳定、命令一致，那就直接用 SkillsCat CLI。它不经过
            <code>/openclaw</code>，而是继续走 SkillsCat 自己的 registry / API 契约。
          </p>
          <pre><code>npx skillscat info &lt;owner&gt;/&lt;repo&gt;
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --agent openclaw
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --skill "&lt;skill-name&gt;" --agent openclaw
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --agent openclaw --global
npx skillscat convert openclaw --from agents</code></pre>
          <ul>
            <li>先 <code>info</code>，再 <code>add</code>，可以避免多 skill 仓库装错内容。</li>
            <li><code>--agent openclaw</code> 会把 bundle 写到 OpenClaw 预期的 layout。</li>
            <li><code>convert openclaw --from agents</code> 适合把已有 <code>.agents</code> 内容迁过去。</li>
          </ul>

          <h2 id="registry-override">替换 site / registry</h2>
          <p>
            如果你希望以后默认都从 SkillsCat 拉 skill，可以把设置做成环境变量或者 shell alias。这样就不用每次都在命令后面重复写
            <code>--site</code> 和 <code>--registry</code>。
          </p>
          <pre><code>export CLAWHUB_SITE=https://skills.cat
export CLAWHUB_REGISTRY=https://skills.cat/openclaw

clawhub search "calendar"
clawhub install &lt;owner&gt;~&lt;skill&gt;
clawhub update &lt;owner&gt;~&lt;skill&gt;</code></pre>
          <p>
            如果你只想临时切换，也可以在单次命令里覆盖。这里要记住一件事:
            <code>CLAWHUB_SITE</code> 是站点根地址，但 <code>CLAWHUB_REGISTRY</code> 要明确指向
            <code>/openclaw</code>，因为原生 <code>/registry</code> 是给 SkillsCat CLI 用的。
          </p>

          <h2 id="paths-and-layout">目录与 bundle 规则</h2>
          <p>
            不管你走 SkillsCat CLI 还是 ClawHub 兼容安装，真正重要的是 bundle 必须完整落地。不要只复制
            <code>SKILL.md</code>，也不要把 templates、scripts、JSON、YAML 这些伴随文件拆掉。
          </p>
          <table>
            <thead>
              <tr>
                <th>目标</th>
                <th>目录</th>
                <th>什么时候用</th>
              </tr>
            </thead>
            <tbody>
              {#each installTargets as item}
                <tr>
                  <td>{item.target}</td>
                  <td><code>{item.path}</code></td>
                  <td>{item.usage}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <ul>
            <li>OpenClaw 读的是整个 folder，不是单个文件。</li>
            <li>本地和全局都存在时，优先检查当前 workspace 下的 <code>skills/</code>。</li>
            <li>装完后重新开一个 OpenClaw session，比热加载更稳。</li>
          </ul>

          <h2 id="private-skills">private skill 与 token</h2>
          <p>
            private skill 或写操作时，要先分清你现在用的是哪套 CLI。<code>clawhub</code> CLI 的浏览器登录会拿到一枚
            SkillsCat 兼容 token；<code>skillscat</code> CLI 则继续用它自己的登录流。
          </p>
          <pre><code>clawhub login --site https://skills.cat
clawhub login --token &lt;skillscat-api-token&gt; --site https://skills.cat --registry https://skills.cat/openclaw
npx skillscat login
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --agent openclaw</code></pre>
          <ul>
            <li><code>clawhub login --site https://skills.cat</code> 会打开 SkillsCat 的兼容授权页，并把 registry 固定回 <code>/openclaw</code>。</li>
            <li>如果你更喜欢手动 token，可以在 SkillsCat 的 <a href="/user/tokens">API tokens</a> 页面创建带 <code>read</code>、<code>write</code>、<code>publish</code> scope 的 token。</li>
            <li><code>skillscat login</code> 只影响 SkillsCat CLI，不会改写 <code>clawhub</code> CLI 的 registry 配置。</li>
          </ul>

          <h2 id="troubleshooting">排查问题</h2>
          <ul>
            <li>安装后没生效，先看目标目录是不是对的，再重开一个 OpenClaw session。</li>
            <li>多 skill 仓库装错了，先跑 <code>npx skillscat info owner/repo</code>，然后用 <code>--skill</code> 精确安装。</li>
            <li>你只想让 OpenClaw 自动拉取，而不想研究兼容 slug，就优先用 <code>npx skillscat add --agent openclaw</code>。</li>
            <li>遇到 private skill 或权限问题，先确认 token scope，再检查命令到底走的是 <code>skillscat</code> CLI 还是 <code>clawhub</code> CLI。</li>
          </ul>

          <blockquote>
            想看原生 <code>skillscat</code> CLI 命令细节，回到 <a href="/docs/cli">CLI docs</a>。这页主要负责把
            <code>clawhub</code> CLI 兼容层和 OpenClaw 安装路径讲清楚。
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
