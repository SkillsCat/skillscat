<script lang="ts">
  import { page } from '$app/stores';
  import { SearchBox, Grid, SkillCard, Section, EmptyState } from '$lib/components';
  import { CATEGORIES } from '$lib/constants';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import {
    Search01Icon,
    GitBranchIcon,
    CodeIcon,
    RefreshIcon,
    Bug01Icon,
    EyeIcon,
    TestTubeIcon,
    SecurityLockIcon,
    SpeedTrain01Icon,
    FileScriptIcon,
    EarthIcon,
    Link01Icon,
    Database01Icon,
    DatabaseExportIcon,
    PaintBrush01Icon,
    AccessIcon,
    Settings01Icon,
    Activity01Icon,
    Folder01Icon,
    WorkflowSquare01Icon,
    SparklesIcon
  } from '@hugeicons/core-free-icons';
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

  // Icon mapping for categories
  const categoryIcons: Record<string, any> = {
    'git': GitBranchIcon,
    'code-generation': CodeIcon,
    'refactoring': RefreshIcon,
    'debugging': Bug01Icon,
    'code-review': EyeIcon,
    'testing': TestTubeIcon,
    'security': SecurityLockIcon,
    'performance': SpeedTrain01Icon,
    'documentation': FileScriptIcon,
    'i18n': EarthIcon,
    'api': Link01Icon,
    'database': Database01Icon,
    'data-processing': DatabaseExportIcon,
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'devops': Settings01Icon,
    'monitoring': Activity01Icon,
    'file-operations': Folder01Icon,
    'automation': WorkflowSquare01Icon,
    'productivity': SparklesIcon
  };

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
    <h1 class="page-title">
      <span class="page-title-icon">
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
      </span>
      Search
    </h1>
    <div class="max-w-xl mt-4">
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
        <div class="category-chips">
          {#each data.matchedCategories as category (category.slug)}
            <a
              href="/category/{category.slug}"
              class="category-chip"
            >
              <span class="category-chip-icon">
                <HugeiconsIcon icon={categoryIcons[category.slug]} size={18} strokeWidth={2} />
              </span>
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
        title="No results found"
        description={`We couldn't find anything matching "${data.query}". Try a different search term.`}
        actionText="Browse Trending Skills"
        actionHref="/trending"
      >
        {#snippet icon()}
          <HugeiconsIcon icon={Search01Icon} size={40} strokeWidth={1.5} />
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <!-- Empty State -->
    <EmptyState
      title="Start searching"
      description="Enter a search term to find skills and categories."
    >
      {#snippet icon()}
        <HugeiconsIcon icon={Search01Icon} size={40} strokeWidth={1.5} />
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

  .category-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .category-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    text-decoration: none;
    transition: all 0.15s ease;
  }

  .category-chip:hover {
    border-color: var(--primary);
    background: var(--primary-subtle);
  }

  .category-chip-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-md);
    color: var(--primary);
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .category-chip:hover .category-chip-icon {
    background: var(--primary);
    color: var(--primary-foreground);
  }
</style>
