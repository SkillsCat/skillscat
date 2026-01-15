<script lang="ts">
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
  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg
         bg-primary text-white hover:bg-primary-hover active:scale-95
         transition-all duration-150 {className}"
>
  {#if copied}
    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
    </svg>
    Copied!
  {:else}
    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
    Copy
  {/if}
</button>
