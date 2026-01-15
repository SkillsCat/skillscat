<script lang="ts">
  import { SearchBox, Grid, SkillCard, EmptyState, ErrorState } from '$lib/components';
  import type { Category } from '$lib/constants/categories';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      category: Category | null;
      skills: SkillCardData[];
    };
  }

  let { data }: Props = $props();

  let searchQuery = $state('');

  const filteredSkills = $derived(
    searchQuery
      ? data.skills.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
      : data.skills
  );
</script>

<svelte:head>
  {#if data.category}
    <title>{data.category.name} Skills - SkillsCat</title>
    <meta name="description" content="{data.category.description}. Browse Claude Code skills in this category." />
  {:else}
    <title>Category Not Found - SkillsCat</title>
  {/if}
</svelte:head>

{#if data.category}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Breadcrumb -->
    <nav class="mb-6 text-sm">
      <ol class="flex items-center gap-2 text-fg-muted">
        <li><a href="/" class="hover:text-primary transition-colors">Home</a></li>
        <li>/</li>
        <li><a href="/categories" class="hover:text-primary transition-colors">Categories</a></li>
        <li>/</li>
        <li class="text-fg font-medium">{data.category.name}</li>
      </ol>
    </nav>

    <!-- Header -->
    <div class="mb-8">
      <div class="flex items-center gap-4 mb-2">
        <span class="text-5xl">{data.category.emoji}</span>
        <h1 class="text-3xl md:text-4xl font-bold text-fg">
          {data.category.name}
        </h1>
      </div>
      <p class="text-fg-muted">{data.category.description}</p>
    </div>

    {#if data.skills.length > 0}
      <!-- Search -->
      <div class="mb-8 max-w-md">
        <SearchBox
          placeholder="Filter skills in {data.category.name}..."
          bind:value={searchQuery}
        />
      </div>

      <!-- Results count -->
      <div class="mb-6 text-sm text-fg-muted">
        Showing {filteredSkills.length} of {data.skills.length} skills
      </div>

      <!-- Skills Grid -->
      <Grid cols={4}>
        {#each filteredSkills as skill (skill.id)}
          <SkillCard {skill} />
        {/each}
      </Grid>

      {#if filteredSkills.length === 0 && searchQuery}
        <EmptyState
          emoji="🔍"
          title="No matches"
          description={`No skills found matching "${searchQuery}"`}
        />
      {/if}
    {:else}
      <EmptyState
        emoji={data.category.emoji}
        title="No skills in this category yet"
        description="Skills will appear here once they're classified into this category."
        actionText="Browse Trending"
        actionHref="/trending"
      />
    {/if}
  </div>
{:else}
  <!-- Not Found -->
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <ErrorState
      emoji="404"
      title="Category Not Found"
      message="The category you're looking for doesn't exist."
    />
    <div class="text-center">
      <a href="/categories" class="btn btn-primary">
        Browse Categories
      </a>
    </div>
  </div>
{/if}
