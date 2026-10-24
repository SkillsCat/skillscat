<script lang="ts">
  interface Props {
    href: string;
    title: string;
    summary: string;
    features: readonly string[];
    action: string;
    kind: 'cli' | 'openclaw';
  }

  let { href, title, summary, features, action, kind }: Props = $props();
</script>

<a {href} class="doc-link-card" class:openclaw={kind === 'openclaw'}>
  <div class="doc-heading">
    <span class="doc-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        {#if kind === 'cli'}
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="m7 9 3 3-3 3m6 0h4" />
        {:else}
          <path d="M8 3h8v4a3 3 0 1 1 0 6v7H9v-4a3 3 0 1 1-6 0V9h5a3 3 0 1 1 0-6Z" />
        {/if}
      </svg>
    </span>
    <h2>{title}</h2>
  </div>
  <p class="doc-summary">{summary}</p>
  <ul class="doc-features">
    {#each features as feature}
      <li><span aria-hidden="true">✓</span>{feature}</li>
    {/each}
  </ul>
  <span class="doc-action">
    {action}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
</a>

<style>
  .doc-link-card {
    --guide-color: var(--primary);
    --guide-bg: var(--primary-subtle);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    padding: clamp(1.25rem, 3vw, 1.75rem);
    border: 1px solid var(--border);
    border-radius: 1.5rem;
    background: var(--bg-subtle);
    box-shadow: 0 3px 0 var(--border);
    color: var(--fg);
    text-decoration: none;
    transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
  }

  .openclaw {
    --guide-color: var(--accent);
    --guide-bg: var(--accent-subtle);
  }

  .doc-heading {
    display: flex;
    align-items: center;
    gap: 0.9rem;
  }

  .doc-icon {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    background: var(--guide-bg);
    color: var(--guide-color);
    border: 1px solid color-mix(in srgb, var(--guide-color) 24%, transparent);
    border-radius: 1rem;
  }

  .doc-icon svg { width: 1.5rem; height: 1.5rem; }
  h2 { margin: 0; font-size: 1.35rem; font-weight: 700; line-height: 1.3; }
  .doc-summary { margin: 0; color: var(--fg-muted); line-height: 1.65; }

  .doc-features {
    display: grid;
    gap: 0.5rem;
    margin: 0 0 0.25rem;
    padding: 0;
    list-style: none;
    color: var(--fg-muted);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .doc-features li { display: flex; align-items: baseline; gap: 0.6rem; }
  .doc-features span { color: var(--guide-color); }

  .doc-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .doc-action svg { flex-shrink: 0; width: 1.25rem; height: 1.25rem; color: var(--guide-color); }
  .doc-link-card:hover { border-color: var(--guide-color); box-shadow: 0 4px 0 var(--guide-bg); transform: translateY(-2px); }
  .doc-link-card:focus-visible { outline: 2px solid var(--primary); outline-offset: 5px; }
  .doc-link-card:active { transform: translateY(1px); box-shadow: none; }
  @media (prefers-reduced-motion: reduce) { .doc-link-card { transition: none; transform: none; } }
</style>
