<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    cols?: 1 | 2 | 3 | 4;
    gap?: 'sm' | 'md' | 'lg';
    children: Snippet;
  }

  let { cols = 4, gap = 'md', children }: Props = $props();

  const colClasses: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
  };

  const gapClasses: Record<string, string> = {
    sm: 'gap-3',
    md: 'gap-4',
    lg: 'gap-6'
  };
</script>

<div class="grid {colClasses[cols]} {gapClasses[gap]}">
  {@render children()}
</div>
