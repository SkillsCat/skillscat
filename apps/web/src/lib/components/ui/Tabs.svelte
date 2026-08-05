<script lang="ts">
  /**
   * Tabs - Segmented-control style tab switcher
   * Items with `href` render as links (page navigation), items with
   * `onclick` render as buttons (in-place state switching).
   */
  import type { Snippet } from 'svelte';
  import { useI18n } from '$lib/i18n/runtime';

  export interface TabItem {
    label: string;
    href?: string;
    active?: boolean;
    count?: number;
    ariaLabel?: string;
    icon?: Snippet;
    onclick?: () => void;
  }

  interface Props {
    items: TabItem[];
    ariaLabel: string;
  }

  let { items, ariaLabel }: Props = $props();

  const i18n = useI18n();
</script>

{#snippet tabContent(item: TabItem)}
  {#if item.icon}
    {@render item.icon()}
  {/if}
  {item.label}
  {#if item.count !== undefined}
    <span class="tab-count" aria-hidden={item.ariaLabel ? 'true' : undefined}>
      {i18n.formatNumber(item.count)}
    </span>
  {/if}
{/snippet}

<nav class="tabs" aria-label={ariaLabel}>
  {#each items as item (item.href ?? item.label)}
    {#if item.href}
      <a
        href={item.href}
        class={item.active ? 'tab active' : 'tab'}
        aria-current={item.active ? 'page' : undefined}
        aria-label={item.ariaLabel}
      >
        {@render tabContent(item)}
      </a>
    {:else}
      <button
        type="button"
        class={item.active ? 'tab active' : 'tab'}
        aria-pressed={item.active ?? false}
        aria-label={item.ariaLabel}
        onclick={item.onclick}
      >
        {@render tabContent(item)}
      </button>
    {/if}
  {/each}
</nav>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: fit-content;
    flex-shrink: 0;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    padding: 0.625rem 1.125rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
    color: var(--muted-foreground);
    font-family: inherit;
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transform: translateY(0);
    transition: all 0.15s ease;
  }

  :global(.dark) .tab {
    box-shadow: 0 3px 0 0 oklch(25% 0.02 85);
  }

  .tab:hover {
    color: var(--foreground);
    border-color: var(--primary);
  }

  .tab:focus-visible {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .tab.active {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-subtle);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.5rem;
    border-radius: var(--radius-full);
    color: var(--muted-foreground);
    background: var(--muted);
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    transition: all 0.15s ease;
  }

  .tab.active .tab-count {
    color: white;
    background: var(--primary);
  }

  @media (max-width: 640px) {
    .tabs {
      width: 100%;
    }

    .tab {
      flex: 1;
      min-height: 2.75rem;
    }
  }
</style>
