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
    isLoading?: boolean;
    suggestionMode?: 'categories' | 'skills';
    showHistory?: boolean;
    suggestionCategory?: string;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    onSearch,
    onSelectSkill,
    class: className = '',
    autofocus = false,
    isLoading = false,
    suggestionMode = 'skills',
    showHistory = true,
    suggestionCategory = '',
  }: Props = $props();

  let SearchBoxComponent = $state<SearchBoxComponentType | null>(null);
  let shouldAutofocusOnUpgrade = $state(false);
  let loadingPromise: Promise<void> | null = null;
  let loadedComponent: SearchBoxComponentType | null = null;
  let fallbackInput = $state<HTMLInputElement>();
  let upgradeTimer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let disposed = false;
  let initialSelection = $state<readonly [number, number] | undefined>();

  function scheduleSearchUpgrade() {
    clearTimeout(upgradeTimer);
    if (!loadedComponent || composing || disposed) return;
    // Keep the actual input in place while typing/pasting or composing IME
    // text. A cached import can otherwise replace it between focus and input.
    upgradeTimer = setTimeout(() => {
      if (composing || disposed) return;
      shouldAutofocusOnUpgrade = document.activeElement === fallbackInput;
      initialSelection = fallbackInput
        ? [fallbackInput.selectionStart ?? value.length, fallbackInput.selectionEnd ?? value.length]
        : undefined;
      SearchBoxComponent = loadedComponent;
    }, 120);
  }

  async function loadSearchBox(options?: { autofocus?: boolean }) {
    if (options?.autofocus) {
      shouldAutofocusOnUpgrade = true;
    }

    if (SearchBoxComponent) {
      return;
    }

    if (loadedComponent) {
      scheduleSearchUpgrade();
      return;
    }

    if (loadingPromise) {
      await loadingPromise;
      return;
    }

    loadingPromise = (async () => {
      try {
        const module = await import('$lib/components/common/SearchBox.svelte');
        loadedComponent = module.default;
        scheduleSearchUpgrade();
      } catch (error) {
        console.error('Failed to load search box enhancement:', error);
      } finally {
        loadingPromise = null;
      }
    })();

    await loadingPromise;
  }

  function commitFallbackSearch() {
    const query = value.trim();
    if (!query) {
      return;
    }

    if (onSearch) {
      onSearch(query);
      return;
    }

    // Local list filters have no submit action; typing already filters the page.
  }

  function handleFallbackSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (composing) return;
    commitFallbackSearch();
  }

  function handleFallbackKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing || composing) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitFallbackSearch();
  }

  onMount(() => {
    if (autofocus) {
      fallbackInput?.focus();
      void loadSearchBox({ autofocus: true });
    }
    return () => {
      disposed = true;
      clearTimeout(upgradeTimer);
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
    {isLoading}
    {suggestionMode}
    {showHistory}
    {suggestionCategory}
    autofocus={shouldAutofocusOnUpgrade}
    {initialSelection}
  />
{:else}
  <form class={`deferred-search-form ${className}`.trim()} onsubmit={handleFallbackSubmit}>
    <div class="deferred-search-shell">
      <span class="deferred-search-icon" aria-hidden="true">
        <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={2} />
      </span>

      <input
        type="search"
        bind:this={fallbackInput}
        bind:value
        oninput={scheduleSearchUpgrade}
        oncompositionstart={() => { composing = true; clearTimeout(upgradeTimer); }}
        oncompositionend={() => { composing = false; scheduleSearchUpgrade(); }}
        placeholder={placeholder}
        aria-label={placeholder}
        class="deferred-search-input"
        autocomplete="off"
        onkeydown={handleFallbackKeydown}
        onfocus={() => void loadSearchBox({ autofocus: true })}
        onpointerdown={() => void loadSearchBox({ autofocus: true })}
      />

      {#if isLoading}
        <span class="deferred-search-loading" aria-hidden="true">
          <span class="deferred-search-spinner"></span>
        </span>
      {/if}
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
    padding: 0.625rem 2.75rem 0.625rem 2.75rem;
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

  .deferred-search-loading {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transform: translateY(-50%);
    color: var(--primary);
  }

  .deferred-search-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 9999px;
    animation: deferred-search-spin 0.75s linear infinite;
  }

  @keyframes deferred-search-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
