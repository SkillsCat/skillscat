<script lang="ts">
  import { onMount } from 'svelte';

  interface TocItem {
    id: string;
    label: string;
  }

  interface Props {
    items: ReadonlyArray<TocItem>;
    title?: string;
  }

  let { items, title = 'TOC' }: Props = $props();
  const firstItemId = $derived(items[0]?.id ?? '');
  let activeId = $state('');
  let isProgrammaticHashUpdate = false;

  $effect(() => {
    if (!activeId && firstItemId) {
      activeId = firstItemId;
    }
  });

  function getHashId(): string {
    if (typeof window === 'undefined') return '';
    return decodeURIComponent(window.location.hash.replace(/^#/, '').trim());
  }

  function setActiveFromHash() {
    const hashId = getHashId();
    if (!hashId) return;
    if (!items.some((item) => item.id === hashId)) return;
    activeId = hashId;
  }

  function syncHash(id: string) {
    if (typeof window === 'undefined' || !id) return;
    const nextHash = `#${encodeURIComponent(id)}`;
    if (window.location.hash === nextHash) return;

    isProgrammaticHashUpdate = true;
    window.history.replaceState(window.history.state, '', nextHash);
    window.setTimeout(() => {
      isProgrammaticHashUpdate = false;
    }, 0);
  }

  function findBestActiveId() {
    if (typeof window === 'undefined' || items.length === 0) return firstItemId;

    const anchorOffset = 136;
    let current = firstItemId;
    let nearestAboveTop = Number.NEGATIVE_INFINITY;
    let nearestBelowTop = Number.POSITIVE_INFINITY;
    let fallbackBelow = firstItemId;

    for (const item of items) {
      const element = document.getElementById(item.id);
      if (!element) continue;

      const top = element.getBoundingClientRect().top - anchorOffset;
      if (top <= 0 && top > nearestAboveTop) {
        nearestAboveTop = top;
        current = item.id;
      } else if (top > 0 && top < nearestBelowTop) {
        nearestBelowTop = top;
        fallbackBelow = item.id;
      }
    }

    return nearestAboveTop > Number.NEGATIVE_INFINITY ? current : fallbackBelow;
  }

  function updateActiveItem({ syncLocation = true } = {}) {
    if (typeof window === 'undefined' || items.length === 0) return;

    const nextActiveId = findBestActiveId();
    if (!nextActiveId) return;

    activeId = nextActiveId;
    if (syncLocation) {
      syncHash(nextActiveId);
    }
  }

  function handleLinkClick(id: string) {
    activeId = id;
  }

  onMount(() => {
    setActiveFromHash();
    updateActiveItem({ syncLocation: !getHashId() });

    const handleScroll = () => updateActiveItem();
    const handleHashChange = () => {
      if (isProgrammaticHashUpdate) return;
      setActiveFromHash();
      updateActiveItem({ syncLocation: false });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('hashchange', handleHashChange);
    };
  });
</script>

<aside class="card docs-toc" aria-labelledby="docs-toc-title">
  <p id="docs-toc-title" class="docs-toc-title">{title}</p>
  <nav aria-label="Table of contents">
    <ul class="docs-toc-list">
      {#each items as item}
        <li>
          <a
            href={`#${encodeURIComponent(item.id)}`}
            class="docs-toc-link"
            data-active={activeId === item.id ? '' : undefined}
            aria-current={activeId === item.id ? 'location' : undefined}
            onclick={() => handleLinkClick(item.id)}
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</aside>

<style>
  .docs-toc {
    display: none;
  }

  @media (min-width: 1100px) {
    .docs-toc {
      position: sticky;
      top: 6rem;
      display: grid;
      gap: 0.9rem;
      align-self: start;
      padding: 1.25rem;
      border-radius: 1.75rem;
      max-height: calc(100vh - 7rem);
      overflow: auto;
    }
  }

  .docs-toc-title {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
  }

  .docs-toc-list {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .docs-toc-link {
    display: block;
    padding: 0.55rem 0.7rem;
    border-radius: 999px;
    color: var(--fg-muted);
    text-decoration: none;
    line-height: 1.4;
    transition:
      color 0.15s ease,
      background-color 0.15s ease,
      transform 0.15s ease;
  }

  .docs-toc-link:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--primary-subtle) 78%, transparent);
    transform: translateX(2px);
  }

  .docs-toc-link[data-active] {
    color: var(--primary);
    background: color-mix(in srgb, var(--primary-subtle) 88%, transparent);
    font-weight: 700;
  }
</style>
