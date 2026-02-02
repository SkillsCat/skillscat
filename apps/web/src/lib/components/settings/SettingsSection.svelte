<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    danger?: boolean;
    children: Snippet;
    actions?: Snippet;
  }

  let {
    title,
    description,
    danger = false,
    children,
    actions,
  }: Props = $props();
</script>

<section class="section" class:danger>
  <div class="section-header">
    <div class="section-title-group">
      <h2>{title}</h2>
      {#if description}
        <p class="section-description">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="section-actions">
        {@render actions()}
      </div>
    {/if}
  </div>
  <div class="section-content">
    {@render children()}
  </div>
</section>

<style>
  .section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .section.danger {
    border-color: rgba(239, 68, 68, 0.3);
  }

  .section.danger h2 {
    color: #ef4444;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .section-title-group {
    flex: 1;
    min-width: 0;
  }

  h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--foreground);
  }

  .section-description {
    color: var(--muted-foreground);
    font-size: 0.875rem;
    margin: 0;
  }

  .section-actions {
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .section-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
