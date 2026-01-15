<script lang="ts">
  interface Props {
    emoji?: string;
    title: string;
    description?: string;
    actionText?: string;
    actionHref?: string;
  }

  let { emoji = '📭', title, description, actionText, actionHref }: Props = $props();
</script>

<div class="text-center py-16">
  <div class="text-6xl mb-4">{emoji}</div>
  <h2 class="text-xl font-semibold text-fg mb-2">{title}</h2>
  {#if description}
    <p class="text-fg-muted mb-6 max-w-md mx-auto">{description}</p>
  {/if}
  {#if actionText && actionHref}
    <a href={actionHref} class="btn btn-primary">
      {actionText}
    </a>
  {/if}
</div>
