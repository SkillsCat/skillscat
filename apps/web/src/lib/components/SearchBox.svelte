<script lang="ts">
  interface Props {
    value?: string;
    placeholder?: string;
    onSearch?: (query: string) => void;
    class?: string;
  }

  let {
    value = $bindable(''),
    placeholder = 'Search skills...',
    onSearch,
    class: className = ''
  }: Props = $props();

  function handleSubmit(e: Event) {
    e.preventDefault();
    onSearch?.(value);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      onSearch?.(value);
    }
  }
</script>

<form onsubmit={handleSubmit} class="relative {className}">
  <div class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  </div>

  <input
    type="search"
    bind:value
    onkeydown={handleKeydown}
    {placeholder}
    class="input pl-10 pr-4"
  />

  {#if value}
    <button
      type="button"
      onclick={() => { value = ''; }}
      class="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg transition-colors"
      aria-label="Clear search"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  {/if}
</form>
