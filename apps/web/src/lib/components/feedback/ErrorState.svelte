<script lang="ts">
  interface Props {
    emoji?: string;
    title?: string;
    message?: string;
    retry?: () => void;
  }

  let { emoji = '😿', title = 'Something went wrong', message, retry }: Props = $props();
</script>

<div class="text-center py-16">
  <div class="text-6xl mb-4">{emoji}</div>
  <h2 class="text-xl font-semibold text-fg mb-2">{title}</h2>
  {#if message}
    <p class="text-fg-muted mb-6 max-w-md mx-auto">{message}</p>
  {/if}
  {#if retry}
    <button onclick={retry} class="btn btn-primary">
      Try Again
    </button>
  {/if}
</div>
