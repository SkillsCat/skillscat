<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Search01Icon, Link01Icon, UserCircleIcon, Mail01Icon } from '@hugeicons/core-free-icons';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    label?: string;
    error?: string;
    icon?: 'search' | 'link' | 'user' | 'mail' | null;
    value?: string;
    variant?: 'default' | 'rounded' | 'cute';
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

  <div class="input-wrapper {variant === 'cute' ? 'input-wrapper-cute' : ''}">
    {#if icon}
      <div class="icon-wrapper">
        <HugeiconsIcon icon={iconMap[icon]} size={20} strokeWidth={2} />
      </div>
    {/if}

    <input
      id={inputId}
      bind:value
      class="input-field {variant === 'rounded' ? 'input-rounded' : ''} {variant === 'cute' ? 'input-cute' : ''} {icon ? 'has-icon' : ''} {error ? 'has-error' : ''} {className}"
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

  .input-wrapper {
    position: relative;
  }

  .input-wrapper-cute {
    --input-shadow-offset: 3px;
    --input-shadow-color: oklch(75% 0.02 85);
    box-shadow: 0 var(--input-shadow-offset) 0 0 var(--input-shadow-color);
    border-radius: var(--radius-xl);
    transform: translateY(0);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .input-wrapper-cute:focus-within {
    --input-shadow-offset: 1px;
    transform: translateY(2px);
  }

  :global(.dark) .input-wrapper-cute {
    --input-shadow-color: oklch(25% 0.02 85);
  }

  .icon-wrapper {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg-subtle);
    pointer-events: none;
    z-index: 1;
    transition: color 0.15s ease;
  }

  .input-wrapper-cute:focus-within .icon-wrapper {
    color: var(--primary);
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

  .input-field.input-cute {
    border-width: 2px;
    border-radius: var(--radius-xl);
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .input-field.input-cute:focus {
    border-color: var(--primary);
    background: var(--background);
    box-shadow: none;
    transform: none;
  }

  .input-field.has-error {
    border-color: var(--error);
  }

  .input-field.has-error:focus {
    border-color: var(--error);
    box-shadow: 0 0 0 4px color-mix(in oklch, var(--error) 20%, transparent);
  }

  .input-field.input-cute.has-error:focus {
    box-shadow: none;
  }

  .error-message {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: var(--error);
    font-weight: 500;
  }
</style>
