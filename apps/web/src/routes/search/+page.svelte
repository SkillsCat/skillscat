<script lang="ts">
  import { page } from '$app/stores';
  import { SearchBox, Grid, SkillCard, Section, EmptyState } from '$lib/components';
  import { CATEGORIES } from '$lib/constants';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      query: string;
      skills: SkillCardData[];
      matchedCategories: typeof CATEGORIES;
    };
  }

  let { data }: Props = $props();

  let searchValue = $state('');

  $effect(() => {
    searchValue = data.query;
  });

  function handleSearch(newQuery: string) {
    if (newQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(newQuery.trim())}`;
    }
  }
</script>

<svelte:head>
  <title>{data.query ? `Search: ${data.query}` : 'Search'} - SkillsCat</title>
  <meta name="description" content="Search Claude Code skills and categories." />
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl md:text-4xl font-bold text-fg mb-4">
      Search
    </h1>
    <div class="max-w-xl">
      <SearchBox
        bind:value={searchValue}
        onSearch={handleSearch}
        placeholder="Search skills, categories..."
      />
    </div>
  </div>

  {#if data.query}
    <!-- Results Summary -->
    <div class="mb-8 text-fg-muted">
      Found {data.skills.length} skills and {data.matchedCategories.length} categories for "{data.query}"
    </div>

    <!-- Categories -->
    {#if data.matchedCategories.length > 0}
      <Section title="Categories" class="mb-8">
        <div class="flex flex-wrap gap-3">
          {#each data.matchedCategories as category (category.slug)}
            <a
              href="/category/{category.slug}"
              class="flex items-center gap-2 px-4 py-2 rounded-lg border border-border
                     hover:bg-bg-muted hover:border-primary transition-colors"
            >
              <span class="text-xl">{category.emoji}</span>
              <span class="font-medium text-fg">{category.name}</span>
            </a>
          {/each}
        </div>
      </Section>
    {/if}

    <!-- Skills -->
    {#if data.skills.length > 0}
      <Section title="Skills">
        <Grid cols={4}>
          {#each data.skills as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      </Section>
    {/if}

    <!-- No Results -->
    {#if data.skills.length === 0 && data.matchedCategories.length === 0}
      <EmptyState
        emoji="🔍"
        title="No results found"
        description={`We couldn't find anything matching "${data.query}". Try a different search term.`}
        actionText="Browse Trending Skills"
        actionHref="/trending"
      />
    {/if}
  {:else}
    <!-- Empty State -->
    <EmptyState
      emoji="🔎"
      title="Start searching"
      description="Enter a search term to find skills and categories."
    />
  {/if}
</div>
