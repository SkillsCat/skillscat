<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import { buildOgImageUrl } from '$lib/seo/og';

  const title = 'SkillsCat Docs';
  const description =
    'Official SkillsCat documentation hub. Read the CLI reference and the OpenClaw integration guide from stable, SEO-friendly paths.';
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs' });
  const repoUrl = 'https://github.com/backrunner/skillscat';

  const docs = [
    {
      href: '/docs/cli',
      eyebrow: 'CLI',
      summary: '用一套命令完成搜索、安装、更新和发布。',
      bullets: [
        '搜索与仓库检查',
        '安装、登录、更新、发布',
      ],
    },
    {
      href: '/docs/openclaw',
      eyebrow: 'OpenClaw',
      summary: '把技能正确装进 OpenClaw 或 ClawBot 的目录结构。',
      bullets: [
        '目标路径与 CLI 参数',
        'Bundle 规则与重启检查',
      ],
    },
  ] as const;
</script>

<SEO
  {title}
  {description}
  url="/docs"
  image={ogImageUrl}
  imageAlt="SkillsCat documentation hub preview"
  keywords={['skillscat docs', 'skillscat cli docs', 'openclaw docs', 'skillscat openclaw']}
/>

<div class="docs-page">
  <div class="docs-shell">
    <section class="card docs-hero">
      <div class="docs-hero-meta">
        <p class="docs-eyebrow">Documentation</p>
        <code class="docs-route">/docs</code>
      </div>
      <h1>SkillsCat Documentation</h1>
      <p class="docs-summary">
        Start here to learn what SkillsCat is, how the CLI works, and how to use it with OpenClaw.
      </p>
    </section>

    <section class="docs-grid" aria-label="Documentation pages">
      {#each docs as doc}
        <a href={doc.href} class="doc-link-card" aria-label={`Read ${doc.eyebrow} documentation`}>
          <div class="doc-link-meta">
            <span class="doc-link-eyebrow">{doc.eyebrow}</span>
            <code>{doc.href}</code>
          </div>
          <div class="doc-link-copy">
            <p class="doc-link-summary">{doc.summary}</p>
          </div>
          <ul class="doc-link-list">
            {#each doc.bullets as bullet}
              <li class="doc-link-item">{bullet}</li>
            {/each}
          </ul>
          <span class="doc-link-cta">Read Doc</span>
        </a>
      {/each}
    </section>

    <DocsProseCard title="docs/README.md">
      <p>
        SkillsCat 是一个帮助你发现、安装、发布 AI agent skills 的产品。它会把 prompt、
        scripts、templates 这些配套文件一起管理好，让 skill 真正能被装上、跑起来、复用起来。
      </p>

      <h2>它解决什么问题</h2>
      <ul>
        <li>
          先搜到合适的 skill，再决定要不要装，不用靠仓库名盲猜。
        </li>
        <li>
          安装时把 skill 需要的文件一起带上，避免只复制一段 prompt，结果实际不能用。
        </li>
        <li>
          用同一套 CLI 处理安装、更新、登录和发布，流程更顺，也更适合团队协作。
        </li>
        <li>
          需要接 OpenClaw 时，也能按正确目录落地，不用手动搬文件。
        </li>
      </ul>

      <h2>适合谁</h2>
      <ul>
        <li>想快速给 agent 加能力的个人用户。</li>
        <li>想把内部 workflow 打包成可复用 skill 的团队。</li>
        <li>需要在本地项目、共享环境、OpenClaw 之间复用同一套 skill 的开发者。</li>
      </ul>

      <h2>从哪里开始</h2>
      <p>
        想先学怎么搜、怎么装、怎么更新，就看 <a href="/docs/cli">CLI 文档</a>。如果你已经在用
        OpenClaw 或 ClawBot，就直接看 <a href="/docs/openclaw">OpenClaw 文档</a>。
      </p>
    </DocsProseCard>

    <section class="card github-star-card" aria-labelledby="github-star-title">
      <div class="github-star-copy">
        <p class="github-star-eyebrow">GitHub</p>
        <h2 id="github-star-title">Star SkillsCat on GitHub</h2>
        <p class="github-star-summary">
          Follow releases, product changes, docs updates, and the ongoing work around portable
          agent skills in one place.
        </p>
      </div>

      <div class="github-star-actions">
        <a
          href={repoUrl}
          class="github-star-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.111.793-.261.793-.577V20.6c-3.338.726-4.034-1.416-4.034-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.744.084-.729.084-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.763-1.605-2.665-.304-5.467-1.334-5.467-5.93 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.523.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 6.844c1.02.005 2.047.138 3.006.404 2.291-1.552 3.299-1.23 3.299-1.23.653 1.653.241 2.873.118 3.176.768.84 1.235 1.911 1.235 3.221 0 4.608-2.804 5.625-5.475 5.922.43.372.817 1.102.817 2.222v3.293c0 .319.192.69.8.576C20.565 21.798 24 17.302 24 12c0-6.627-5.373-12-12-12z"
            />
          </svg>
          Star on GitHub
        </a>
      </div>
    </section>
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
    gap: 0.85rem;
    padding: 2rem;
    border-radius: 1.75rem;
  }

  .docs-hero-meta,
  .doc-link-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .docs-eyebrow,
  .doc-link-eyebrow {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
  }

  .docs-route,
  .doc-link-meta code {
    display: inline-flex;
    align-items: center;
    min-height: 1.9rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--bg-subtle);
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }

  h1,
  h2 {
    margin: 0;
    color: var(--fg);
  }

  h1 {
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 1.05;
  }

  .docs-summary,
  .doc-link-card li {
    color: var(--fg-muted);
    line-height: 1.65;
  }

  .docs-grid {
    display: grid;
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .doc-link-card {
    position: relative;
    overflow: visible;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 10.25rem;
    padding: 0.95rem 1rem;
    background: var(--card);
    border: 3px solid var(--border-sketch);
    border-radius: 1.75rem;
    text-decoration: none;
    color: inherit;
    transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .doc-link-card::before {
    content: '';
    position: absolute;
    inset: -3px;
    border: 3px solid transparent;
    border-radius: 1.75rem;
    background: linear-gradient(135deg, var(--primary), var(--accent)) border-box;
    -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
  }

  .doc-link-card:hover,
  .doc-link-card:focus-visible {
    transform: translateY(-6px) rotate(0.5deg);
    box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.12);
    border-color: transparent;
  }

  .doc-link-card:hover::before,
  .doc-link-card:focus-visible::before {
    opacity: 1;
  }

  .doc-link-card:active {
    transform: translateY(2px) scale(0.992);
    box-shadow: 0 3px 10px -10px rgb(0 0 0 / 0.12);
  }

  .doc-link-copy {
    display: grid;
    gap: 0.25rem;
  }

  .doc-link-summary {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.84rem;
    line-height: 1.38;
  }

  .doc-link-list {
    display: grid;
    gap: 0.1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .doc-link-item {
    position: relative;
    padding: 0.05rem 0 0.05rem 0.9rem;
    color: var(--fg-muted);
    font-size: 0.79rem;
    line-height: 1.42;
    transition: color 0.2s ease;
  }

  .doc-link-item::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.53rem;
    width: 0.32rem;
    height: 0.32rem;
    border-radius: 999px;
    background: var(--primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-subtle) 72%, transparent);
  }

  .doc-link-card:hover .doc-link-item,
  .doc-link-card:focus-visible .doc-link-item {
    color: color-mix(in srgb, var(--fg-muted) 72%, var(--fg) 28%);
  }

  .doc-link-cta {
    align-self: flex-end;
    margin-top: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.35rem;
    padding: 0.5rem 0.95rem;
    border-radius: 999px;
    border: 1px solid var(--primary);
    background: var(--primary);
    color: #ffffff;
    font-size: 0.82rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      opacity 0.2s ease;
  }

  .doc-link-card:hover .doc-link-cta,
  .doc-link-card:focus-visible .doc-link-cta {
    background: var(--primary-hover);
    color: #ffffff;
    border-color: var(--primary-hover);
  }

  .github-star-card {
    display: grid;
    gap: 1rem;
    padding: 1.5rem;
    border-radius: 1.75rem;
  }

  .github-star-copy {
    display: grid;
    gap: 0.45rem;
  }

  .github-star-eyebrow {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
  }

  .github-star-summary {
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.65;
  }

  .github-star-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .github-star-link {
    --btn-shadow-offset: 4px;
    --btn-shadow-color: oklch(36% 0.02 260);

    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    min-height: 2.75rem;
    padding: 0.7rem 1rem;
    border-radius: 999px;
    background: #24292f;
    color: #ffffff;
    text-decoration: none;
    font-weight: 700;
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
    transform: translateY(0);
    transition:
      transform 0.1s ease,
      box-shadow 0.1s ease,
      background-color 0.15s ease;
  }

  .github-star-link svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }

  .github-star-link:hover {
    --btn-shadow-offset: 6px;
    background: #2f363d;
    transform: translateY(-2px);
  }

  .github-star-link:active {
    --btn-shadow-offset: 1px;
    transform: translateY(3px);
  }

  @media (min-width: 900px) {
    .docs-page {
      padding: 2rem 1.5rem 4rem;
    }

    .docs-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .github-star-card {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }
  }

  @media (max-width: 640px) {
    .doc-link-card {
      min-height: 0;
      padding: 0.9rem;
    }
  }

  .docs-shell :global(.skill-content-card) {
    border-radius: 1.75rem;
  }
</style>
