<script lang="ts">
  import { onMount } from 'svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Search01Icon } from '@hugeicons/core-free-icons';

  type SearchBoxComponentType = typeof import('$lib/components/common/SearchBox.svelte').default;

  interface SkillSuggestion {
    slug: string;
  }

  interface Props {
    value?: string;
    placeholder?: string;
    onSearch?: (query: string) => void;
    onSelectSkill?: (skill: SkillSuggestion) => void;
    class?: string;
    autofocus?: boolean;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    onSearch,
    onSelectSkill,
    class: className = '',
    autofocus = false,
  }: Props = $props();

  let SearchBoxComponent = $state<SearchBoxComponentType | null>(null);
  let shouldAutofocusOnUpgrade = $state(false);
  let loadingPromise: Promise<void> | null = null;

  async function loadSearchBox(options?: { autofocus?: boolean }) {
    if (options?.autofocus) {
      shouldAutofocusOnUpgrade = true;
    }

    if (SearchBoxComponent) {
      return;
    }

    if (loadingPromise) {
      await loadingPromise;
      return;
    }

    loadingPromise = (async () => {
      try {
        const module = await import('$lib/components/common/SearchBox.svelte');
        SearchBoxComponent = module.default;
      } catch (error) {
        console.error('Failed to load search box enhancement:', error);
      } finally {
        loadingPromise = null;
      }
    })();

    await loadingPromise;
  }

  function handleFallbackSubmit(event: SubmitEvent) {
    event.preventDefault();

    const query = value.trim();
    if (!query) {
      return;
    }

    if (onSearch) {
      onSearch(query);
      return;
    }

    window.location.href = `/search?q=${encodeURIComponent(query)}`;
  }

  onMount(() => {
    if (autofocus) {
      void loadSearchBox({ autofocus: true });
      return;
    }

    const preload = () => {
      void loadSearchBox();
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
</script>

{#if SearchBoxComponent}
  <SearchBoxComponent
    bind:value
    placeholder={placeholder}
    class={className}
    {onSearch}
    {onSelectSkill}
    suggestionMode="skills"
    autofocus={shouldAutofocusOnUpgrade}
  />
{:else}
  <form class={`deferred-search-form ${className}`.trim()} onsubmit={handleFallbackSubmit}>
    <div class="deferred-search-shell">
      <span class="deferred-search-icon" aria-hidden="true">
        <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={2} />
      </span>

      <input
        type="search"
        bind:value
        placeholder={placeholder}
        class="deferred-search-input"
        autocomplete="off"
        onfocus={() => void loadSearchBox({ autofocus: true })}
        onpointerdown={() => void loadSearchBox({ autofocus: true })}
      />
    </div>
  </form>
{/if}

<style>
  .deferred-search-form {
    position: relative;
  }

  .deferred-search-shell {
    --input-shadow-offset: 3px;
    --input-shadow-color: oklch(75% 0.02 85);

    position: relative;
    display: flex;
    align-items: center;
    box-shadow: 0 var(--input-shadow-offset) 0 0 var(--input-shadow-color);
    border-radius: var(--radius-full);
  }

  :global(.dark) .deferred-search-shell {
    --input-shadow-color: oklch(25% 0.02 85);
  }

  .deferred-search-icon {
    position: absolute;
    left: 0.875rem;
    top: 50%;
    z-index: 1;
    display: flex;
    align-items: center;
    color: var(--fg-subtle);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .deferred-search-input {
    width: 100%;
    padding: 0.625rem 1rem 0.625rem 2.75rem;
    font-size: 0.875rem;
    font-family: var(--font-sans);
    color: var(--foreground);
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    outline: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .deferred-search-input[type='search'] {
    appearance: textfield;
  }

  .deferred-search-input::-webkit-search-decoration,
  .deferred-search-input::-webkit-search-cancel-button,
  .deferred-search-input::-webkit-search-results-button,
  .deferred-search-input::-webkit-search-results-decoration {
    appearance: none;
    -webkit-appearance: none;
    display: none;
  }

  .deferred-search-input:focus {
    border-color: var(--primary);
    background: var(--background);
  }

  .deferred-search-input::placeholder {
    color: var(--muted-foreground);
  }
</style>
