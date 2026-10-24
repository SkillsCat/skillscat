<script lang="ts">
  import type { Snippet } from 'svelte';
  import DocsTableOfContents from './DocsTableOfContents.svelte';

  interface Props {
    title: string;
    eyebrow: string;
    summary: string;
    backHref?: string;
    backLabel?: string;
    toc?: ReadonlyArray<{ id: string; label: string }>;
    tocTitle?: string;
    tocLabel?: string;
    children: Snippet;
  }

  let { title, eyebrow, summary, backHref, backLabel, toc, tocTitle, tocLabel, children }: Props = $props();
</script>

<div class="docs-page">
  <div class="docs-shell">
    <header class="docs-hero">
      <div class="docs-hero-meta">
        {#if backHref}
          <a href={backHref} class="docs-back-link" aria-label={backLabel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="m12 5-7 7 7 7M5 12h14" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
        {:else}
          <span class="docs-book" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 5.5C9 3.5 5 3.5 3 4v15c3-.5 6-.5 9 1 3-1.5 6-1.5 9-1V4c-2-.5-6-.5-9 1.5Zm0 0V20" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        {/if}
        <p class="docs-eyebrow">{eyebrow}</p>
      </div>
      <h1>{title}</h1>
      <p class="docs-summary">{summary}</p>
    </header>

    <div class="docs-content-grid" class:with-toc={toc?.length}>
      <div class="docs-main">
        {@render children()}
      </div>
      {#if toc?.length}
        <DocsTableOfContents items={toc} title={tocTitle} label={tocLabel} />
      {/if}
    </div>
  </div>
</div>

<style>
  .docs-page {
    padding: 2rem 1rem 4rem;
  }

  .docs-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2rem;
    max-width: 72rem;
    min-width: 0;
    margin: 0 auto;
    overflow-wrap: anywhere;
  }

  .docs-hero {
    display: grid;
    justify-items: start;
    gap: 1rem;
    padding: 0.5rem 0;
  }

  .docs-hero-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .docs-book,
  .docs-back-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 2.75rem;
    height: 2.75rem;
    border: 1px solid var(--border);
    border-radius: 0.9rem;
    background: var(--bg-subtle);
    color: var(--primary);
  }

  .docs-book {
    border-color: color-mix(in srgb, var(--primary) 25%, var(--border));
    background: var(--primary-subtle);
    transform: rotate(-5deg);
  }

  .docs-back-link:hover {
    border-color: var(--primary);
    background: var(--primary-subtle);
  }

  svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .docs-eyebrow {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--primary);
  }

  h1 {
    margin: 0;
    max-width: 24ch;
    color: var(--fg);
    font-size: clamp(2rem, 4vw, 3rem);
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 1.2;
    text-wrap: balance;
  }

  .docs-summary {
    max-width: 48rem;
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.7;
    text-wrap: pretty;
  }

  .docs-content-grid,
  .docs-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.5rem;
    min-width: 0;
  }

  @media (min-width: 900px) {
    .docs-page { padding: 3rem 1.5rem 5rem; }
  }

  @media (min-width: 1100px) {
    .with-toc {
      grid-template-columns: minmax(0, 1fr) 18rem;
      align-items: start;
    }
  }
</style>
