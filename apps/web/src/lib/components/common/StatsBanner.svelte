<script lang="ts">
  interface Props {
    count: number;
  }

  let { count }: Props = $props();
</script>

<div class="stats-capsule">
  <span class="stats-icon">✨</span>
  <span class="stats-text">
    SkillsCat found
    <span class="stats-count">{count.toLocaleString()}</span>
    agent skills
  </span>
</div>

<style>
  .stats-capsule {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-full);
    box-shadow: 0 3px 0 0 oklch(50% 0.22 55);
  }

  :global(.dark) .stats-capsule {
    box-shadow: 0 3px 0 0 oklch(40% 0.20 55);
  }

  .stats-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .stats-text {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
  }

  .stats-count {
    font-weight: 700;
    color: var(--primary);
    margin: 0 0.125rem;
  }
</style>
