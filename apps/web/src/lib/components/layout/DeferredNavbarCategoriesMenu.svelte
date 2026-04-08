<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { onMount } from 'svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { ArrowDown01Icon } from '@hugeicons/core-free-icons';

  type NavbarCategoriesContentComponentType =
    typeof import('$lib/components/layout/NavbarCategoriesContent.svelte').default;

  interface Props {
    label: string;
    value?: string;
    active?: boolean;
  }

  let { label, value = $bindable(''), active = false }: Props = $props();

  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  let NavbarCategoriesContentComponent = $state<NavbarCategoriesContentComponentType | null>(null);
  let loadingPromise: Promise<boolean> | null = null;
  let loadFailed = $state(false);

  async function loadNavbarCategoriesContent(): Promise<boolean> {
    if (NavbarCategoriesContentComponent) {
      return true;
    }

    if (loadingPromise) {
      return await loadingPromise;
    }

    loadingPromise = (async () => {
      try {
        const module = await import('$lib/components/layout/NavbarCategoriesContent.svelte');
        NavbarCategoriesContentComponent = module.default;
        loadFailed = false;
        return true;
      } catch (error) {
        console.error('Failed to load categories menu content:', error);
        loadFailed = true;
        return false;
      } finally {
        loadingPromise = null;
      }
    })();

    return await loadingPromise;
  }

  function preloadNavbarCategoriesContent(): void {
    void loadNavbarCategoriesContent();
  }

  onMount(() => {
    const preload = () => {
      preloadNavbarCategoriesContent();
    };

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId = 0;

    if ('requestIdleCallback' in window) {
      idleId = (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
          cancelIdleCallback?: (id: number) => void;
        }
      ).requestIdleCallback(preload, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(preload, 1500);
    }

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      if (idleId && 'cancelIdleCallback' in window) {
        (
          window as Window & {
            cancelIdleCallback?: (id: number) => void;
          }
        ).cancelIdleCallback?.(idleId);
      }
    };
  });

  $effect(() => {
    if (value !== 'categories' || NavbarCategoriesContentComponent || loadFailed) {
      return;
    }

    void loadNavbarCategoriesContent();
  });
</script>

<NavigationMenu.Root class="nav-menu-root" bind:value={value}>
  <NavigationMenu.List class="nav-menu-list">
    <NavigationMenu.Item value="categories">
      <NavigationMenu.Trigger
        class="nav-link nav-trigger"
        data-active={active ? '' : undefined}
        onfocus={preloadNavbarCategoriesContent}
        onpointerenter={preloadNavbarCategoriesContent}
        onpointermove={preloadNavbarCategoriesContent}
      >
        {label}
        <span class="nav-link-chevron">
          <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
        </span>
      </NavigationMenu.Trigger>

      <NavigationMenu.Content class="nav-content">
        {#if NavbarCategoriesContentComponent}
          <NavbarCategoriesContentComponent />
        {:else if loadFailed}
          <div class="nav-content-fallback">
            <NavigationMenu.Link href="/categories" class="view-all-link">
              {messages.categories.viewAll}
            </NavigationMenu.Link>
          </div>
        {:else}
          <div class="nav-content-loading" aria-hidden="true">
            <div class="nav-content-loading-grid">
              {#each Array.from({ length: 6 }) as _, index}
                <div class="nav-content-loading-card" data-wide={index < 2 ? '' : undefined}>
                  <div class="nav-content-loading-title"></div>
                  <div class="nav-content-loading-row"></div>
                  <div class="nav-content-loading-row nav-content-loading-row-short"></div>
                </div>
              {/each}
            </div>

            <div class="nav-content-loading-footer">
              <div class="nav-content-loading-link"></div>
            </div>
          </div>
        {/if}
      </NavigationMenu.Content>
    </NavigationMenu.Item>

    <NavigationMenu.Indicator class="nav-indicator">
      <div class="nav-indicator-arrow"></div>
    </NavigationMenu.Indicator>
  </NavigationMenu.List>

  <NavigationMenu.Viewport class="nav-viewport" />
</NavigationMenu.Root>

<style>
  .nav-content-loading {
    box-sizing: border-box;
    width: min(calc(100vw - 2rem), 56rem);
  }

  .nav-content-loading-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.4rem;
    padding: 0.8rem 0.85rem 0.7rem;
  }

  .nav-content-loading-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.2rem 0.35rem;
  }

  .nav-content-loading-title,
  .nav-content-loading-row,
  .nav-content-loading-link {
    border-radius: 999px;
    background: linear-gradient(90deg, var(--bg-muted), var(--card), var(--bg-muted));
    background-size: 200% 100%;
    animation: nav-content-loading-shimmer 1.4s ease-in-out infinite;
  }

  .nav-content-loading-title {
    width: 45%;
    height: 0.625rem;
    margin-bottom: 0.15rem;
  }

  .nav-content-loading-row {
    width: 100%;
    height: 1.9rem;
    border-radius: var(--radius-md);
  }

  .nav-content-loading-row-short {
    width: 82%;
  }

  .nav-content-loading-footer {
    padding: 0.55rem 0.85rem 0.65rem;
    border-top: 2px solid var(--border);
    background-color: var(--bg-muted);
  }

  .nav-content-loading-link {
    width: 8rem;
    max-width: 100%;
    height: 0.875rem;
    margin: 0 auto;
  }

  .nav-content-fallback {
    box-sizing: border-box;
    min-width: min(calc(100vw - 2rem), 18rem);
    padding: 1rem;
  }

  .nav-content-fallback :global(.view-all-link) {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--primary);
    text-decoration: none;
    text-align: center;
    transition: transform 0.2s ease;
  }

  .nav-content-fallback :global(.view-all-link:hover) {
    transform: translateX(4px);
  }

  @media (max-width: 1023px) {
    .nav-content-loading {
      width: min(calc(100vw - 1.5rem), 50rem);
    }
  }

  @keyframes nav-content-loading-shimmer {
    0% {
      background-position: 100% 50%;
    }

    100% {
      background-position: 0 50%;
    }
  }
</style>
