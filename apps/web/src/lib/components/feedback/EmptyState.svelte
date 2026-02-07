<script lang="ts">
  import { Button } from '$lib/components';
  import type { Snippet } from 'svelte';

  interface Props {
    emoji?: string;
    icon?: Snippet;
    title: string;
    description?: string;
    actionText?: string;
    actionHref?: string;
  }

  let { emoji, icon, title, description, actionText, actionHref }: Props = $props();
</script>

<div class="empty-state">
  <div class="empty-state-icon">
    {#if icon}
      {@render icon()}
    {:else if emoji}
      <span class="emoji">{emoji}</span>
    {/if}
  </div>
  <h2 class="empty-state-title">{title}</h2>
  {#if description}
    <p class="empty-state-description">{description}</p>
  {/if}
  {#if actionText && actionHref}
    <Button href={actionHref} variant="cute">
      {actionText}
    </Button>
  {/if}
</div>

<style>
  .empty-state {
    text-align: center;
    padding: 3rem 1.5rem;
  }

  .empty-state-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 5rem;
    height: 5rem;
    margin-bottom: 1.5rem;
    background: var(--primary-subtle);
    border: 3px solid var(--border-sketch);
    border-radius: 50%;
    animation: bounce-gentle 2s ease-in-out infinite;
  }

  .empty-state-icon :global(svg) {
    width: 2.5rem;
    height: 2.5rem;
    color: var(--primary);
  }

  .emoji {
    font-size: 2.5rem;
    line-height: 1;
  }

  .empty-state-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--fg);
    margin-bottom: 0.5rem;
  }

  .empty-state-description {
    font-size: 0.9375rem;
    color: var(--fg-muted);
    max-width: 20rem;
    margin: 0 auto 1.5rem;
    line-height: 1.6;
  }

  @keyframes bounce-gentle {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }
</style>
