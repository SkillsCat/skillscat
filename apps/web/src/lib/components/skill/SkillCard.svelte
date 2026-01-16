<script lang="ts">
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { UserCircleIcon, StarIcon, Clock01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    skill: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
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
  class="skill-card group block"
>
  <div class="flex items-start gap-4">
    <!-- Author Avatar -->
    <div class="flex-shrink-0 avatar-wrapper">
      {#if skill.authorAvatar}
        <img
          src={skill.authorAvatar}
          alt={skill.repoOwner}
          class="w-12 h-12 rounded-full bg-bg-muted border-3 border-border-sketch"
        />
      {:else}
        <div class="w-12 h-12 rounded-full bg-primary-subtle border-3 border-border-sketch
                    flex items-center justify-center text-primary">
          <HugeiconsIcon icon={UserCircleIcon} size={24} strokeWidth={2} />
        </div>
      {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <!-- Title -->
      <h3 class="font-bold text-fg group-hover:text-primary transition-colors duration-200 truncate text-lg">
        {skill.name}
      </h3>

      <!-- Author -->
      <p class="text-sm text-fg-muted font-medium truncate">
        by {skill.repoOwner}
      </p>

      <!-- Description -->
      {#if skill.description}
        <p class="mt-2 text-sm text-fg-muted line-clamp-2 leading-relaxed">
          {skill.description}
        </p>
      {/if}

      <!-- Meta -->
      <div class="mt-3 flex items-center gap-4">
        <!-- Stars -->
        <span class="meta-badge">
          <HugeiconsIcon icon={StarIcon} size={14} strokeWidth={2} />
          {formatNumber(skill.stars)}
        </span>

        <!-- Updated -->
        <span class="meta-badge">
          <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={2} />
          {formatRelativeTime(skill.updatedAt)}
        </span>
      </div>
    </div>
  </div>
</a>

<style>
  .skill-card {
    position: relative;
    padding: 1.25rem;
    background: var(--card);
    border: 3px solid var(--border-sketch);
    border-radius: 1rem;
    transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .skill-card::before {
    content: '';
    position: absolute;
    inset: -3px;
    border: 3px solid var(--border-sketch);
    border-radius: 1rem;
    opacity: 0.15;
    transform: rotate(-0.5deg);
    pointer-events: none;
    transition: opacity 0.25s ease;
  }

  .skill-card:hover {
    transform: translateY(-6px) rotate(0.5deg);
    box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.12);
  }

  .skill-card:hover::before {
    opacity: 0.3;
  }

  .avatar-wrapper {
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .skill-card:hover .avatar-wrapper {
    transform: scale(1.1) rotate(-5deg);
  }

  .meta-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--fg-muted);
    background: var(--bg-muted);
    border-radius: 9999px;
    transition: all 0.2s ease;
  }

  .skill-card:hover .meta-badge {
    background: var(--primary-subtle);
    color: var(--primary);
  }
</style>
