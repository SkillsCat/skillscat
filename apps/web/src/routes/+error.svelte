<script lang="ts">
  import { page } from '$app/stores';
  import { Button } from '$lib/components';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { SadDizzyIcon, Home01Icon, ArrowLeft01Icon } from '@hugeicons/core-free-icons';
</script>

<svelte:head>
  <title>{$page.status} - SkillsCat</title>
</svelte:head>

<div class="error-page">
  <div class="error-content">
    <div class="error-icon">
      <HugeiconsIcon icon={SadDizzyIcon} size={80} strokeWidth={1.5} />
    </div>

    <h1 class="error-code">{$page.status}</h1>

    <p class="error-message">
      {#if $page.status === 404}
        Oops! This page doesn't exist.
      {:else}
        Something went wrong.
      {/if}
    </p>

    {#if $page.error?.message}
      <p class="error-detail">{$page.error.message}</p>
    {/if}

    <div class="error-actions">
      <Button variant="cute" href="/">
        <HugeiconsIcon icon={Home01Icon} size={18} strokeWidth={2} />
        Go Home
      </Button>
      <Button variant="outline" onclick={() => history.back()}>
        <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
        Go Back
      </Button>
    </div>
  </div>
</div>

<style>
  .error-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 12rem);
    padding: 2rem;
  }

  .error-content {
    text-align: center;
    max-width: 28rem;
  }

  .error-icon {
    color: var(--fg-muted);
    margin-bottom: 1.5rem;
    opacity: 0.6;
  }

  .error-code {
    font-size: clamp(4rem, 10vw, 8rem);
    font-weight: 900;
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    margin-bottom: 1rem;
  }

  .error-message {
    font-size: 1.25rem;
    color: var(--fg);
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .error-detail {
    font-size: 0.875rem;
    color: var(--fg-muted);
    margin-bottom: 2rem;
  }

  .error-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }
</style>
