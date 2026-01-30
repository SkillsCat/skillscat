<script lang="ts">
  import { Grid, SkillCard, EmptyState, SearchBox } from '$lib/components';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { SecurityLockIcon, Search01Icon, Bookmark02Icon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      favorites: SkillCardData[];
      isAuthenticated: boolean;
    };
  }

  let { data }: Props = $props();

  let searchQuery = $state('');

  const filteredBookmarks = $derived(
    searchQuery
      ? data.favorites.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
      : data.favorites
  );
</script>

<svelte:head>
  <title>Bookmarks - SkillsCat</title>
  <meta name="description" content="Your bookmarked Claude Code skills collection." />
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="page-title">
      <span class="page-title-icon">
        <HugeiconsIcon icon={Bookmark02Icon} strokeWidth={2} />
      </span>
      Bookmarks
    </h1>
    <p class="text-fg-muted">
      Your bookmarked Claude Code skills
    </p>
  </div>

  {#if !data.isAuthenticated}
    <EmptyState
      title="Sign in to view bookmarks"
      description="You need to be signed in to save and view your bookmarked skills."
      actionText="Sign In"
      actionHref="/api/auth/signin"
    >
      {#snippet icon()}
        <HugeiconsIcon icon={SecurityLockIcon} size={40} strokeWidth={1.5} />
      {/snippet}
    </EmptyState>
  {:else if data.favorites.length > 0}
    <!-- Search -->
    <div class="mb-8 max-w-md">
      <SearchBox
        placeholder="Filter bookmarks..."
        bind:value={searchQuery}
      />
    </div>

    <!-- Results count -->
    <div class="mb-6 text-sm text-fg-muted">
      {filteredBookmarks.length} of {data.favorites.length} bookmarks
    </div>

    <!-- Bookmarks Grid -->
    <Grid cols={3}>
      {#each filteredBookmarks as skill (skill.id)}
        <SkillCard {skill} />
      {/each}
    </Grid>

    {#if filteredBookmarks.length === 0 && searchQuery}
      <EmptyState
        title="No matches"
        description={`No bookmarks found matching "${searchQuery}"`}
      >
        {#snippet icon()}
          <HugeiconsIcon icon={Search01Icon} size={40} strokeWidth={1.5} />
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <EmptyState
      title="No bookmarks yet"
      description="Start exploring and bookmark skills you like!"
      actionText="Browse Skills"
      actionHref="/trending"
    >
      {#snippet icon()}
        <HugeiconsIcon icon={Bookmark02Icon} size={40} strokeWidth={1.5} />
      {/snippet}
    </EmptyState>
  {/if}
</div>

<style>
  .page-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 1.875rem;
    font-weight: 700;
    color: var(--fg);
    margin-bottom: 0.5rem;
  }

  @media (min-width: 768px) {
    .page-title {
      font-size: 2.25rem;
    }
  }

  .page-title-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-lg);
    color: var(--primary);
    flex-shrink: 0;
  }

  @media (min-width: 768px) {
    .page-title-icon {
      width: 3rem;
      height: 3rem;
    }
  }

  .page-title-icon :global(svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  @media (min-width: 768px) {
    .page-title-icon :global(svg) {
      width: 1.5rem;
      height: 1.5rem;
    }
  }
</style>
