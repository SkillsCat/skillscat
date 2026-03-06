<script lang="ts">
  import Grid from '$lib/components/layout/Grid.svelte';
  import SkillCard from '$lib/components/skill/SkillCard.svelte';
  import EmptyState from '$lib/components/feedback/EmptyState.svelte';
  import SearchBox from '$lib/components/common/SearchBox.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { useI18n } from '$lib/i18n/runtime';
  import { getSettingsCopy } from '$lib/i18n/settings';
  import { SecurityLockIcon, Search01Icon, Bookmark02Icon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      favorites: SkillCardData[];
      isAuthenticated: boolean;
    };
  }

  let { data }: Props = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const copy = $derived(getSettingsCopy(i18n.locale()));

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
  <title>{copy.bookmarks.title} - SkillsCat</title>
  <meta name="description" content={copy.bookmarks.description} />
  <link rel="canonical" href="https://skills.cat/bookmarks" />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="page-title">
      <span class="page-title-icon">
        <HugeiconsIcon icon={Bookmark02Icon} strokeWidth={2} />
      </span>
      {copy.bookmarks.title}
    </h1>
    <p class="text-fg-muted">
      {copy.bookmarks.description}
    </p>
  </div>

  {#if !data.isAuthenticated}
    <EmptyState
      title={copy.bookmarks.signInTitle}
      description={copy.bookmarks.signInDescription}
      actionText={messages.common.signIn}
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
        placeholder={copy.bookmarks.filterPlaceholder}
        bind:value={searchQuery}
      />
    </div>

    <!-- Results count -->
    <div class="mb-6 text-sm text-fg-muted">
      {i18n.t(copy.bookmarks.countSummary, {
        shown: filteredBookmarks.length,
        total: data.favorites.length,
      })}
    </div>

    <!-- Bookmarks Grid -->
    <Grid cols={3}>
      {#each filteredBookmarks as skill (skill.id)}
        <SkillCard {skill} />
      {/each}
    </Grid>

    {#if filteredBookmarks.length === 0 && searchQuery}
      <EmptyState
        title={messages.common.noMatches}
        description={i18n.t(messages.common.noMatchesFor, { query: searchQuery })}
      >
        {#snippet icon()}
          <HugeiconsIcon icon={Search01Icon} size={40} strokeWidth={1.5} />
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <EmptyState
      title={copy.bookmarks.emptyTitle}
      description={copy.bookmarks.emptyDescription}
      actionText={messages.common.browseSkills}
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
