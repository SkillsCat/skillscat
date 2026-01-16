<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { StarIcon } from '@hugeicons/core-free-icons';

  interface Props {
    skill: {
      id: string;
      name: string;
      slug: string;
      repoOwner: string;
      stars: number;
      updatedAt: number;
      authorAvatar?: string;
    };
  }

  let { skill }: Props = $props();

  function formatNumber(num: number): string {
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
  }

  function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / 86400000);
    const months = Math.floor(days / 30);

    if (months > 0) return `${months}mo ago`;
    if (days > 0) return `${days}d ago`;
    return 'today';
  }
</script>

<a
  href="/skills/{skill.slug}"
  class="skill-card-compact group"
>
  <!-- Avatar -->
  <div class="flex-shrink-0 avatar-wrapper">
    {#if skill.authorAvatar}
      <img
        src={skill.authorAvatar}
        alt={skill.repoOwner}
        class="w-10 h-10 rounded-full bg-bg-muted border-2 border-border-sketch"
      />
    {:else}
      <div class="w-10 h-10 rounded-full bg-primary-subtle border-2 border-border-sketch
                  flex items-center justify-center text-primary font-bold text-sm">
        {skill.repoOwner.charAt(0).toUpperCase()}
      </div>
    {/if}
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <span class="font-semibold text-fg group-hover:text-primary transition-colors truncate">
        {skill.name}
      </span>
    </div>
    <div class="text-xs text-fg-muted font-medium">
      by {skill.repoOwner}
    </div>
  </div>

  <!-- Meta -->
  <div class="flex-shrink-0 flex items-center gap-3">
    <span class="meta-badge-compact">
      <HugeiconsIcon icon={StarIcon} size={12} strokeWidth={2} />
      {formatNumber(skill.stars)}
    </span>
    <span class="text-xs text-fg-subtle font-medium">
      {formatRelativeTime(skill.updatedAt)}
    </span>
  </div>
</a>

<style>
  .skill-card-compact {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 0.875rem 1rem;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: 0.875rem;
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .skill-card-compact:hover {
    border-color: var(--border-sketch);
    transform: translateX(4px);
    box-shadow: -4px 4px 0 0 var(--border-sketch);
  }

  .avatar-wrapper {
    transition: transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .skill-card-compact:hover .avatar-wrapper {
    transform: scale(1.1);
  }

  .meta-badge-compact {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--fg-muted);
    background: var(--bg-muted);
    border-radius: 9999px;
    transition: all 0.2s ease;
  }

  .skill-card-compact:hover .meta-badge-compact {
    background: var(--primary-subtle);
    color: var(--primary);
  }
</style>
