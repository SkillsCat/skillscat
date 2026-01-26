<script lang="ts">
  interface Props {
    emoji?: string;
    title?: string;
    message?: string;
    retry?: () => void;
    useIcon?: boolean;
  }

  let { emoji = '😢', title = 'Something went wrong', message, retry, useIcon = false }: Props = $props();
</script>

<div class="text-center py-16">
  <div class="error-icon-wrapper">
    {#if useIcon}
      <img src="/favicon-96x96.png" alt="" class="error-icon" />
    {:else}
      <span class="text-6xl">{emoji}</span>
    {/if}
  </div>
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

<style>
  .error-icon-wrapper {
    margin-bottom: 1rem;
  }

  .error-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto;
    opacity: 0.6;
    filter: grayscale(50%);
  }
</style>
