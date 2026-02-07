<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { LockIcon, ViewOffIcon, GlobeIcon } from '@hugeicons/core-free-icons';

  interface Props {
    visibility: 'public' | 'private' | 'unlisted';
    size?: 'sm' | 'md';
  }

  let { visibility, size = 'sm' }: Props = $props();

  const config = $derived({
    private: { icon: LockIcon, label: 'Private' },
    unlisted: { icon: ViewOffIcon, label: 'Unlisted' },
    public: { icon: GlobeIcon, label: 'Public' },
  }[visibility]);
</script>

<span class="badge {visibility} {size}">
  <HugeiconsIcon icon={config.icon} size={size === 'sm' ? 12 : 14} strokeWidth={2} />
  {config.label}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-weight: 600;
    border-radius: 9999px;
    white-space: nowrap;
    line-height: 1;
  }

  .badge.sm {
    padding: 0.2em 0.6em;
    font-size: 0.75rem;
    border-width: 1.5px;
    border-style: solid;
    box-shadow: 0 2px 0 0 var(--badge-shadow);
  }

  .badge.md {
    padding: 0.25em 0.75em;
    font-size: 0.8125rem;
    border-width: 2px;
    border-style: solid;
    box-shadow: 0 2px 0 0 var(--badge-shadow);
  }

  /* Private - red */
  .badge.private {
    color: oklch(45% 0.18 25);
    background: oklch(95% 0.03 25);
    border-color: oklch(75% 0.12 25);
    --badge-shadow: oklch(75% 0.12 25);
  }

  :global(:root.dark) .badge.private {
    color: oklch(75% 0.14 25);
    background: oklch(25% 0.06 25);
    border-color: oklch(45% 0.12 25);
    --badge-shadow: oklch(35% 0.10 25);
  }

  /* Unlisted - amber */
  .badge.unlisted {
    color: oklch(45% 0.14 75);
    background: oklch(95% 0.04 85);
    border-color: oklch(75% 0.12 75);
    --badge-shadow: oklch(75% 0.12 75);
  }

  :global(:root.dark) .badge.unlisted {
    color: oklch(78% 0.12 75);
    background: oklch(25% 0.05 75);
    border-color: oklch(45% 0.10 75);
    --badge-shadow: oklch(35% 0.08 75);
  }

  /* Public - green */
  .badge.public {
    color: oklch(40% 0.14 150);
    background: oklch(95% 0.04 150);
    border-color: oklch(70% 0.12 150);
    --badge-shadow: oklch(70% 0.12 150);
  }

  :global(:root.dark) .badge.public {
    color: oklch(75% 0.14 150);
    background: oklch(25% 0.05 150);
    border-color: oklch(45% 0.10 150);
    --badge-shadow: oklch(35% 0.08 150);
  }
</style>
