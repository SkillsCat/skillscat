<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    text: string;
    size?: 'sm' | 'md';
    class?: string;
  }

  let { text, size = 'md', class: className = '' }: Props = $props();
  let copied = $state(false);

  function copyToClipboard() {
    navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  const iconSize = $derived(size === 'sm' ? 14 : 16);
</script>

<button
  type="button"
  onclick={copyToClipboard}
  class="copy-button copy-button-{size} {copied ? 'copied' : ''} {className}"
>
  <span class="icon-wrapper {copied ? 'wiggle' : ''}">
    {#if copied}
      <HugeiconsIcon icon={Tick01Icon} size={iconSize} strokeWidth={2.5} />
    {:else}
      <HugeiconsIcon icon={Copy01Icon} size={iconSize} strokeWidth={2.5} />
    {/if}
  </span>
  {#if size !== 'sm'}
    <span class="button-text">
      {copied ? 'Copied!' : 'Copy'}
    </span>
  {/if}
</button>

<style>
  .copy-button {
    --btn-shadow-offset: 4px;
    --btn-shadow-color: oklch(50% 0.22 55);

    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    background: var(--primary);
    color: #ffffff;
    border: none;
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
    cursor: pointer;
    transform: translateY(0);
    transition:
      transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275),
      box-shadow 0.15s ease,
      background-color 0.15s ease;
  }

  .copy-button-md {
    padding: 0.625rem 1rem;
    font-size: 0.9375rem;
    border-radius: var(--radius-lg);
  }

  .copy-button-sm {
    padding: 0.375rem 0.625rem;
    font-size: 0.75rem;
    border-radius: var(--radius-md);
    --btn-shadow-offset: 3px;
  }

  .copy-button:hover {
    background: var(--primary-hover);
    transform: translateY(-2px);
    --btn-shadow-offset: 6px;
  }

  .copy-button-sm:hover {
    --btn-shadow-offset: 4px;
  }

  .copy-button:active {
    --btn-shadow-offset: 1px;
    transform: translateY(2px);
  }

  /* Copied state - green with cute shadow */
  .copy-button.copied {
    --btn-shadow-color: oklch(45% 0.15 145);
    background: oklch(55% 0.18 145);
    transform: translateY(-1px);
    --btn-shadow-offset: 3px;
  }

  .copy-button-sm.copied {
    --btn-shadow-offset: 2px;
    transform: translateY(0);
  }

  /* Dark mode */
  :root.dark .copy-button {
    --btn-shadow-color: oklch(40% 0.20 55);
  }

  :root.dark .copy-button.copied {
    --btn-shadow-color: oklch(35% 0.12 145);
    background: oklch(50% 0.15 145);
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    transition: transform 0.2s ease;
  }

  .icon-wrapper.wiggle {
    animation: wiggle 0.5s ease-in-out;
  }

  @keyframes wiggle {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-10deg); }
    75% { transform: rotate(10deg); }
  }

  .button-text {
    line-height: 1;
  }
</style>
