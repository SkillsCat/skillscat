<script lang="ts">
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
  class="card-interactive group block"
>
  <div class="flex items-start gap-3">
    <!-- Author Avatar -->
    <div class="flex-shrink-0">
      {#if skill.authorAvatar}
        <img
          src={skill.authorAvatar}
          alt={skill.repoOwner}
          class="w-10 h-10 rounded-full bg-bg-muted"
        />
      {:else}
        <div class="w-10 h-10 rounded-full bg-bg-muted flex items-center justify-center text-fg-muted">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
        </div>
      {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <!-- Title -->
      <h3 class="font-semibold text-fg group-hover:text-primary transition-colors truncate">
        {skill.name}
      </h3>

      <!-- Author -->
      <p class="text-sm text-fg-muted truncate">
        {skill.repoOwner}
      </p>

      <!-- Description -->
      {#if skill.description}
        <p class="mt-2 text-sm text-fg-muted line-clamp-2">
          {skill.description}
        </p>
      {/if}

      <!-- Meta -->
      <div class="mt-3 flex items-center gap-4 text-xs text-fg-subtle">
        <!-- Stars -->
        <span class="flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {formatNumber(skill.stars)}
        </span>

        <!-- Updated -->
        <span class="flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {formatRelativeTime(skill.updatedAt)}
        </span>
      </div>
    </div>
  </div>
</a>
