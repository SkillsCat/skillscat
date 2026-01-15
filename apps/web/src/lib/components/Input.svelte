<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    label?: string;
    error?: string;
    icon?: 'search' | 'link' | 'user' | 'mail' | null;
  }

  let {
    label,
    error,
    icon = null,
    class: className = '',
    id,
    ...restProps
  }: Props = $props();

  const inputId = $derived(id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined));
</script>

<div class="w-full">
  {#if label}
    <label for={inputId} class="block text-sm font-medium text-fg-muted mb-1.5">
      {label}
    </label>
  {/if}

  <div class="relative">
    {#if icon}
      <div class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">
        {#if icon === 'search'}
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        {:else if icon === 'link'}
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        {:else if icon === 'user'}
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
        {:else if icon === 'mail'}
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        {/if}
      </div>
    {/if}

    <input
      id={inputId}
      class="input {icon ? 'pl-10' : ''} {error ? 'border-error focus:ring-error/30 focus:border-error' : ''} {className}"
      {...restProps}
    />
  </div>

  {#if error}
    <p class="mt-1.5 text-sm text-error">{error}</p>
  {/if}
</div>
