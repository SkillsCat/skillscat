<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    text: string;
    class?: string;
  }

  let { text, class: className = '' }: Props = $props();
  let copied = $state(false);

  function copyToClipboard() {
    navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }
</script>

<button
  type="button"
  onclick={copyToClipboard}
  class="copy-button {copied ? 'copied' : ''} {className}"
>
  <span class="icon-wrapper {copied ? 'wiggle' : ''}">
    {#if copied}
      <HugeiconsIcon icon={Tick01Icon} size={16} strokeWidth={2.5} />
    {:else}
      <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={2.5} />
    {/if}
  </span>
  <span class="button-text">
    {copied ? 'Copied!' : 'Copy'}
  </span>
</button>

<style>
  .copy-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    font-size: 0.9375rem;
    font-weight: 600;
    background: var(--primary);
    color: var(--primary-foreground);
    border: none;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-cute);
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .copy-button:hover {
    background: var(--primary-hover);
    box-shadow: var(--shadow-cute-hover);
    transform: translateY(-3px);
  }

  .copy-button:active {
    transform: translateY(-1px) scale(0.98);
  }

  .copy-button.copied {
    background: var(--success);
    transform: scale(1.05);
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
