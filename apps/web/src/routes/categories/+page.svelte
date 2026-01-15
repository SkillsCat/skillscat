<script lang="ts">
  import { SearchBox, Grid } from '$lib/components';
  import { CATEGORIES } from '$lib/constants';
  import type { CategoryWithCount } from '$lib/constants/categories';

  interface Props {
    data: {
      categories: CategoryWithCount[];
    };
  }

  let { data }: Props = $props();

  let searchQuery = $state('');

  const filteredCategories = $derived(
    searchQuery
      ? data.categories.filter(
          (c) =>
            c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : data.categories
  );
</script>

<svelte:head>
  <title>Categories - SkillsCat</title>
  <meta name="description" content="Browse Claude Code skills by category." />
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl md:text-4xl font-bold text-fg mb-2">
      📁 Categories
    </h1>
    <p class="text-fg-muted">Browse skills by category to find exactly what you need.</p>
  </div>

  <!-- Search -->
  <div class="mb-8 max-w-md">
    <SearchBox
      placeholder="Search categories..."
      bind:value={searchQuery}
    />
  </div>

  <!-- Results count -->
  <div class="mb-6 text-sm text-fg-muted">
    {filteredCategories.length} categories
  </div>

  <!-- Categories Grid -->
  <Grid cols={3} gap="lg">
    {#each filteredCategories as category (category.slug)}
      <a
        href="/category/{category.slug}"
        class="card-interactive group"
      >
        <div class="flex items-start gap-4">
          <span class="text-4xl">{category.emoji}</span>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-fg group-hover:text-primary transition-colors">
              {category.name}
            </h2>
            <p class="text-sm text-fg-muted mt-1">
              {category.description}
            </p>
            <p class="text-xs text-fg-subtle mt-2">
              {category.skillCount} skills
            </p>
          </div>
        </div>
      </a>
    {/each}
  </Grid>

  {#if filteredCategories.length === 0}
    <div class="text-center py-16">
      <div class="text-6xl mb-4">🔍</div>
      <p class="text-fg-muted">No categories found matching "{searchQuery}"</p>
    </div>
  {/if}
</div>
