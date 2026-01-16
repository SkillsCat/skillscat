<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Search01Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
  import { CATEGORIES } from '$lib/constants';

  interface Props {
    value?: string;
    placeholder?: string;
    onSearch?: (query: string) => void;
    class?: string;
    showSuggestions?: boolean;
  }

  let {
    value = $bindable(''),
    placeholder = 'Search skills...',
    onSearch,
    class: className = '',
    showSuggestions = true
  }: Props = $props();

  let isFocused = $state(false);
  let inputElement: HTMLInputElement;

  // Filter suggestions based on input
  const suggestions = $derived(() => {
    if (!value.trim() || !isFocused || !showSuggestions) return [];

    const query = value.toLowerCase();
    return CATEGORIES
      .filter(cat =>
        cat.name.toLowerCase().includes(query) ||
        cat.slug.toLowerCase().includes(query)
      )
      .slice(0, 5);
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    isFocused = false;
    onSearch?.(value);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      isFocused = false;
      onSearch?.(value);
    } else if (e.key === 'Escape') {
      isFocused = false;
      inputElement?.blur();
    }
  }

  function selectSuggestion(categoryName: string) {
    value = categoryName;
    isFocused = false;
    onSearch?.(value);
  }

  function clearSearch() {
    value = '';
    inputElement?.focus();
  }
</script>

<form onsubmit={handleSubmit} class="search-form {className}">
  <!-- Search Input -->
  <div class="search-input-wrapper">
    <div class="search-icon">
      <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={2} />
    </div>

    <input
      bind:this={inputElement}
      type="search"
      bind:value
      onkeydown={handleKeydown}
      onfocus={() => { isFocused = true; }}
      onblur={() => { setTimeout(() => { isFocused = false; }, 200); }}
      {placeholder}
      class="search-input"
      autocomplete="off"
    />

    {#if value}
      <button
        type="button"
        onclick={clearSearch}
        class="clear-btn"
        aria-label="Clear search"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2.5} />
      </button>
    {/if}
  </div>

  <!-- Suggestions Dropdown -->
  {#if suggestions().length > 0}
    <div class="suggestions-dropdown">
      <div class="suggestions-list">
        {#each suggestions() as category (category.slug)}
          <button
            type="button"
            onclick={() => selectSuggestion(category.name)}
            class="suggestion-item"
          >
            <span class="suggestion-emoji">
              {category.emoji}
            </span>
            <span class="suggestion-name">
              {category.name}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</form>

<style>
  .search-form {
    position: relative;
  }

  .search-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.875rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg-subtle);
    pointer-events: none;
    z-index: 1;
    display: flex;
    align-items: center;
  }

  .search-input {
    width: 100%;
    padding: 0.625rem 2.5rem 0.625rem 2.75rem;
    font-size: 0.875rem;
    font-family: var(--font-sans);
    color: var(--foreground);
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    outline: none;
    transition: all 0.15s ease;
  }

  .search-input:focus {
    border-color: var(--primary);
    box-shadow: 4px 4px 0 0 var(--primary-subtle);
  }

  .search-input::placeholder {
    color: var(--muted-foreground);
  }

  .clear-btn {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    background: none;
    border: none;
    color: var(--fg-subtle);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.15s ease;
  }

  .clear-btn:hover {
    color: var(--fg);
    background: var(--muted);
  }

  .suggestions-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 0.5rem;
    z-index: 50;
    background: var(--card);
    border: 2px solid var(--border-sketch);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .suggestions-list {
    padding: 0.5rem;
  }

  .suggestion-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .suggestion-item:hover {
    background: var(--primary-subtle);
  }

  .suggestion-emoji {
    font-size: 1.25rem;
    line-height: 1;
  }

  .suggestion-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
  }

  .suggestion-item:hover .suggestion-name {
    color: var(--primary);
  }
</style>
