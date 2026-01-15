<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    href?: string;
    children: Snippet;
  }

  let { title, href, children }: Props = $props();
</script>

<section class="mb-12">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-2xl font-bold text-fg">{title}</h2>
    {#if href}
      <a
        {href}
        class="text-sm font-medium text-primary hover:text-primary-hover transition-colors flex items-center gap-1"
      >
        View all
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </a>
    {/if}
  </div>
  {@render children()}
</section>
