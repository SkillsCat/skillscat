<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Search01Icon, Link01Icon, UserCircleIcon, Mail01Icon } from '@hugeicons/core-free-icons';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    label?: string;
    error?: string;
    icon?: 'search' | 'link' | 'user' | 'mail' | null;
    value?: string;
    variant?: 'default' | 'rounded';
  }

  let {
    label,
    error,
    icon = null,
    class: className = '',
    id,
    value = $bindable(''),
    variant = 'default',
    ...restProps
  }: Props = $props();

  const inputId = $derived(id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined));

  const iconMap = {
    search: Search01Icon,
    link: Link01Icon,
    user: UserCircleIcon,
    mail: Mail01Icon
  };
</script>

<div class="w-full">
  {#if label}
    <label for={inputId} class="input-label">
      {label}
    </label>
  {/if}

  <div class="relative">
    {#if icon}
      <div class="icon-wrapper">
        <HugeiconsIcon icon={iconMap[icon]} size={20} strokeWidth={2} />
      </div>
    {/if}

    <input
      id={inputId}
      bind:value
      class="input-field {variant === 'rounded' ? 'input-rounded' : ''} {icon ? 'has-icon' : ''} {error ? 'has-error' : ''} {className}"
      {...restProps}
    />
  </div>

  {#if error}
    <p class="error-message">{error}</p>
  {/if}
</div>

<style>
  .input-label {
    display: block;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--fg-muted);
    margin-bottom: 0.5rem;
  }

  .icon-wrapper {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg-subtle);
    pointer-events: none;
    z-index: 1;
  }

  .input-field {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 0.9375rem;
    font-family: var(--font-sans);
    color: var(--foreground);
    background: var(--card);
    border: 3px solid var(--border);
    border-radius: var(--radius-lg);
    outline: none;
    transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .input-field:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 4px var(--primary-subtle);
    transform: translateY(-2px);
  }

  .input-field::placeholder {
    color: var(--muted-foreground);
  }

  .input-field.has-icon {
    padding-left: 3rem;
  }

  .input-field.input-rounded {
    border-radius: var(--radius-full);
  }

  .input-field.has-error {
    border-color: var(--error);
  }

  .input-field.has-error:focus {
    border-color: var(--error);
    box-shadow: 0 0 0 4px color-mix(in oklch, var(--error) 20%, transparent);
  }

  .error-message {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: var(--error);
    font-weight: 500;
  }
</style>
