<script lang="ts">
  import { useI18n } from '$lib/i18n/runtime';
  import { getDocsPresentation } from '$lib/i18n/docs-presentation';
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsPage from '$lib/components/docs/DocsPage.svelte';
  import DocsGuideCard from '$lib/components/docs/DocsGuideCard.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import ChineseDocsContent from '$lib/components/docs/ChineseDocsContent.svelte';
  import CatalanDocsContent from '$lib/components/docs/CatalanDocsContent.svelte';
  import { buildOgImageUrl } from '$lib/seo/og';

  const i18n = useI18n();
  const isCatalan = $derived(i18n.locale() === 'ca');
  const presentation = $derived(getDocsPresentation(i18n.locale()));
  const copy = $derived(presentation.index);
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs' });
</script>

<SEO title={copy.title} description={copy.description} url="/docs" image={ogImageUrl}
  imageAlt={copy.imageAlt} keywords={['skillscat docs', 'skillscat cli docs', 'openclaw docs', 'skillscat openclaw']} />

<DocsPage title={copy.title} eyebrow={copy.eyebrow} summary={copy.summary}>
  <section class="docs-grid" aria-label={copy.pagesLabel}>
    <DocsGuideCard kind="cli" href={i18n.href('/docs/cli')} title="SkillsCat CLI"
      summary={copy.cliSummary} features={copy.cliFeatures} action={presentation.readGuide} />
    <DocsGuideCard kind="openclaw" href={i18n.href('/docs/openclaw')} title="OpenClaw"
      summary={copy.openclawSummary} features={copy.openclawFeatures} action={presentation.readGuide} />
  </section>

  <DocsProseCard title={copy.overview}>
    {#if isCatalan}
      <CatalanDocsContent kind="index" />
    {:else if i18n.locale() === 'zh-CN'}
      <ChineseDocsContent kind="index" />
    {:else}
      <p>
        SkillsCat is a registry and CLI for AI agent skills. Find the right skill first, then
        install the full bundle into a project, OpenClaw, or a shared team environment instead of
        hand-copying a few loose files.
      </p>

      <h2>What It Is</h2>
      <ul>
        <li>A searchable AI agent skill catalog, so you do not have to guess from GitHub repo names alone.</li>
        <li>A CLI that installs complete bundles, not just a copied <code>SKILL.md</code>.</li>
        <li>A single entry point for OpenClaw, ClawBot, and local projects to use the same skill source.</li>
      </ul>

      <h2>What You Can Do</h2>
      <ul>
        <li>Search for task-specific skills, inspect the contents, and then decide whether to install.</li>
        <li>Install templates, scripts, configs, and the rest of a bundle together instead of assembling them by hand.</li>
        <li>Handle installs, updates, auth, publishing, and OpenClaw integration from one toolchain.</li>
      </ul>

      <h2>Where To Start</h2>
      <p>
        If you want to learn how to search, install, and update, start with the
        <a href="/docs/cli"> CLI docs</a>. If you already use OpenClaw or ClawBot, or you want
        SkillsCat to replace the default registry, jump to the
        <a href="/docs/openclaw"> OpenClaw guide</a>.
      </p>
    {/if}
  </DocsProseCard>

  <section class="github-star-card" aria-labelledby="github-star-title">
    <div class="github-star-copy">
      <span class="github-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.111.793-.261.793-.577V20.6c-3.338.726-4.034-1.416-4.034-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.744.084-.729.084-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.763-1.605-2.665-.304-5.467-1.334-5.467-5.93 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.523.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 6.844c1.02.005 2.047.138 3.006.404 2.291-1.552 3.299-1.23 3.299-1.23.653 1.653.241 2.873.118 3.176.768.84 1.235 1.911 1.235 3.221 0 4.608-2.804 5.625-5.475 5.922.43.372.817 1.102.817 2.222v3.293c0 .319.192.69.8.576C20.565 21.798 24 17.302 24 12c0-6.627-5.373-12-12-12z" />
        </svg>
      </span>
      <div>
        <h2 id="github-star-title">{copy.githubTitle}</h2>
        <p>{copy.githubSummary}</p>
      </div>
    </div>
    <a href="https://github.com/skillscat/skillscat" class="github-star-link" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" stroke-linejoin="round" />
      </svg>
      {copy.githubAction}
    </a>
  </section>
</DocsPage>

<style>
  .docs-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
    padding-bottom: 0.25rem;
  }
  .github-star-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 1.5rem;
    background: var(--bg-subtle);
  }
  .github-star-copy { display: flex; align-items: center; gap: 0.875rem; flex: 1 1 20rem; min-width: 0; }
  .github-star-copy > div { min-width: 0; }
  .github-mark {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.9rem;
    background: var(--bg-muted);
    color: var(--fg);
  }
  .github-mark svg { width: 1.375rem; height: 1.375rem; }
  h2 { margin: 0 0 0.25rem; font-size: 1rem; font-weight: 600; color: var(--fg); }
  p { margin: 0; line-height: 1.5; color: var(--fg-muted); font-size: 0.875rem; }
  .github-star-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0.65rem 1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-subtle);
    color: var(--fg);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
  }
  .github-star-link:hover { color: var(--primary); border-color: var(--primary); }
  .github-star-link svg { width: 1.1rem; height: 1.1rem; flex-shrink: 0; color: var(--primary); }
  @media (max-width: 480px) { .github-star-link { width: 100%; } }
  @media (min-width: 760px) { .docs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
