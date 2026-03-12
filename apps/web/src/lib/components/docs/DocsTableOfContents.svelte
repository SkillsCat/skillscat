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
  const desktopBreakpoint = 1100;
  const stickyTop = 96;
  const activeHeadingOffset = 136;
  let activeId = $state('');
  let isProgrammaticHashUpdate = false;
  let tocShell: HTMLDivElement | null = null;
  let tocElement: HTMLElement | null = null;
  let tocShellStyle = $state('');
  let tocStyle = $state('');
  let tocMode = $state<'static' | 'fixed' | 'bottom'>('static');
  let scheduledFrame = 0;

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

    let current = firstItemId;
    let nearestAboveTop = Number.NEGATIVE_INFINITY;
    let nearestBelowTop = Number.POSITIVE_INFINITY;
    let fallbackBelow = firstItemId;

    for (const item of items) {
      const element = document.getElementById(item.id);
      if (!element) continue;

      const top = element.getBoundingClientRect().top - activeHeadingOffset;
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

  function resetStickyPosition() {
    tocMode = 'static';
    tocShellStyle = '';
    tocStyle = '';
  }

  function resolveStickyBoundary(): HTMLElement | null {
    if (!tocShell) return null;

    const contentGrid = tocShell.closest('.docs-content-grid');
    if (!(contentGrid instanceof HTMLElement)) return null;

    const mainColumn = contentGrid.querySelector('.docs-main');
    return mainColumn instanceof HTMLElement ? mainColumn : contentGrid;
  }

  function updateStickyPosition() {
    if (typeof window === 'undefined' || !tocShell || !tocElement) return;

    if (window.innerWidth < desktopBreakpoint) {
      resetStickyPosition();
      return;
    }

    const shellRect = tocShell.getBoundingClientRect();
    const tocHeight = tocElement.offsetHeight;
    const boundary = resolveStickyBoundary();
    const boundaryRect = boundary?.getBoundingClientRect();

    if (!shellRect.width || !tocHeight || !boundaryRect) {
      resetStickyPosition();
      return;
    }

    const scrollY = window.scrollY;
    const shellTop = shellRect.top + scrollY;
    const boundaryTop = boundaryRect.top + scrollY;
    const boundaryBottom = boundaryTop + boundaryRect.height;
    const fixedStart = shellTop - stickyTop;
    const fixedEnd = boundaryBottom - stickyTop - tocHeight;

    tocShellStyle = `position: relative; min-height: ${tocHeight}px;`;

    if (scrollY <= fixedStart) {
      tocMode = 'static';
      tocStyle = '';
      return;
    }

    if (scrollY >= fixedEnd) {
      const absoluteTop = Math.max(0, boundaryBottom - shellTop - tocHeight);
      tocMode = 'bottom';
      tocStyle = `position: absolute; top: ${absoluteTop}px; left: 0; width: ${shellRect.width}px;`;
      return;
    }

    tocMode = 'fixed';
    tocStyle = `position: fixed; top: ${stickyTop}px; left: ${shellRect.left}px; width: ${shellRect.width}px;`;
  }

  function scheduleViewportSync() {
    if (typeof window === 'undefined' || scheduledFrame) return;

    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = 0;
      updateStickyPosition();
      updateActiveItem();
    });
  }

  onMount(() => {
    setActiveFromHash();
    updateStickyPosition();
    updateActiveItem({ syncLocation: !getHashId() });

    const handleScroll = () => scheduleViewportSync();
    const handleHashChange = () => {
      if (isProgrammaticHashUpdate) return;
      setActiveFromHash();
      updateStickyPosition();
      updateActiveItem({ syncLocation: false });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    window.addEventListener('resize', handleScroll);
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      if (scheduledFrame) {
        window.cancelAnimationFrame(scheduledFrame);
        scheduledFrame = 0;
      }
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('hashchange', handleHashChange);
    };
  });
</script>

<div class="docs-toc-shell" bind:this={tocShell} style={tocShellStyle}>
  <aside
    class="card docs-toc"
    bind:this={tocElement}
    style={tocStyle}
    data-mode={tocMode}
    aria-labelledby="docs-toc-title"
  >
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
</div>

<style>
  .docs-toc-shell {
    display: none;
  }

  @media (min-width: 1100px) {
    .docs-toc-shell {
      display: block;
      position: relative;
    }

    .docs-toc {
      display: grid;
      gap: 0.9rem;
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
