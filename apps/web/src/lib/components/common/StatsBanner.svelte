<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { SparklesIcon } from '@hugeicons/core-free-icons';

  interface Props {
    count: number;
  }

  let { count }: Props = $props();
</script>

<div class="stats-capsule">
  <span class="stats-icon">
    <HugeiconsIcon icon={SparklesIcon} size={14} strokeWidth={2.5} />
  </span>
  <span class="stats-text">
    <span class="stats-count">{count.toLocaleString()}</span>
    agent skills indexed
  </span>
</div>

<style>
  .stats-capsule {
    --capsule-shadow-offset: 3px;
    --capsule-shadow-color: oklch(50% 0.22 55);

    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.875rem;
    background: var(--card);
    border: 2px solid var(--primary);
    border-radius: var(--radius-full);
    box-shadow: 0 var(--capsule-shadow-offset) 0 0 var(--capsule-shadow-color);
    transform: translateY(0);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .stats-capsule:hover {
    --capsule-shadow-offset: 4px;
    transform: translateY(-1px);
  }

  :global(.dark) .stats-capsule {
    --capsule-shadow-color: oklch(40% 0.20 55);
  }

  .stats-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
  }

  .stats-text {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--fg-muted);
    letter-spacing: -0.01em;
  }

  .stats-count {
    font-weight: 700;
    color: var(--primary);
    margin-right: 0.125rem;
  }
</style>
