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
    gap: 0.125rem;
    width: fit-content;
    padding: 0.1875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--muted);
    flex-shrink: 0;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-height: 2rem;
    padding: 0.375rem 0.625rem;
    border: none;
    border-radius: calc(var(--radius-md) - 2px);
    background: transparent;
    color: var(--muted-foreground);
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }

  .tab:hover {
    color: var(--foreground);
  }

  .tab:focus-visible {
    outline: none;
    color: var(--foreground);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .tab.active {
    color: var(--foreground);
    background: var(--background);
    box-shadow: 0 1px 2px color-mix(in oklch, var(--foreground) 12%, transparent);
  }

  .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.3125rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--foreground);
    background: var(--background);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }

  .tab.active .tab-count {
    color: var(--primary);
    border-color: transparent;
    background: var(--primary-subtle);
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
