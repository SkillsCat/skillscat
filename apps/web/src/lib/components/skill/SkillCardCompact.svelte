<script lang="ts">
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
  class="flex items-center gap-3 p-3 rounded-lg hover:bg-bg-muted transition-colors group"
>
  <!-- Avatar -->
  <div class="flex-shrink-0">
    {#if skill.authorAvatar}
      <img
        src={skill.authorAvatar}
        alt={skill.repoOwner}
        class="w-8 h-8 rounded-full bg-bg-muted"
      />
    {:else}
      <div class="w-8 h-8 rounded-full bg-bg-muted flex items-center justify-center text-fg-subtle text-xs">
        {skill.repoOwner.charAt(0).toUpperCase()}
      </div>
    {/if}
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <span class="font-medium text-fg group-hover:text-primary transition-colors truncate">
        {skill.name}
      </span>
    </div>
    <div class="text-xs text-fg-subtle">
      {skill.repoOwner}
    </div>
  </div>

  <!-- Meta -->
  <div class="flex-shrink-0 flex items-center gap-3 text-xs text-fg-subtle">
    <span class="flex items-center gap-1">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      {formatNumber(skill.stars)}
    </span>
    <span>{formatRelativeTime(skill.updatedAt)}</span>
  </div>
</a>
