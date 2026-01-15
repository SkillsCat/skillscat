<script lang="ts">
  import { Grid, SkillCard, EmptyState, SearchBox } from '$lib/components';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      favorites: SkillCardData[];
      isAuthenticated: boolean;
    };
  }

  let { data }: Props = $props();

  let searchQuery = $state('');

  const filteredFavorites = $derived(
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
  <title>My Favorites - SkillsCat</title>
  <meta name="description" content="Your saved Claude Code skills collection." />
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl md:text-4xl font-bold text-fg mb-2">
      My Favorites
    </h1>
    <p class="text-fg-muted">
      Your saved Claude Code skills
    </p>
  </div>

  {#if !data.isAuthenticated}
    <EmptyState
      emoji="🔒"
      title="Sign in to view favorites"
      description="You need to be signed in to save and view your favorite skills."
      actionText="Sign In"
      actionHref="/api/auth/signin"
    />
  {:else if data.favorites.length > 0}
    <!-- Search -->
    <div class="mb-8 max-w-md">
      <SearchBox
        placeholder="Filter favorites..."
        bind:value={searchQuery}
      />
    </div>

    <!-- Results count -->
    <div class="mb-6 text-sm text-fg-muted">
      {filteredFavorites.length} of {data.favorites.length} favorites
    </div>

    <!-- Favorites Grid -->
    <Grid cols={4}>
      {#each filteredFavorites as skill (skill.id)}
        <SkillCard {skill} />
      {/each}
    </Grid>

    {#if filteredFavorites.length === 0 && searchQuery}
      <EmptyState
        emoji="🔍"
        title="No matches"
        description={`No favorites found matching "${searchQuery}"`}
      />
    {/if}
  {:else}
    <EmptyState
      emoji="💝"
      title="No favorites yet"
      description="Start exploring and save skills you like!"
      actionText="Browse Skills"
      actionHref="/trending"
    />
  {/if}
</div>
