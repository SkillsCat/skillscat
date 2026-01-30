<script lang="ts">
  import { SearchBox, Grid, SkillCard, EmptyState, ErrorState } from '$lib/components';
  import type { Category } from '$lib/constants/categories';
  import type { SkillCardData } from '$lib/types';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import {
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
    SparklesIcon,
    Search01Icon,
    Sad01Icon,
    AlertCircleIcon
  } from '@hugeicons/core-free-icons';

  interface Props {
    data: {
      category: Category | null;
      skills: SkillCardData[];
    };
  }

  let { data }: Props = $props();

  let searchQuery = $state('');

  // Icon mapping for categories (same as Navbar and categories page)
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
        <div class="category-icon-large">
          <HugeiconsIcon icon={categoryIcons[data.category.slug]} size={32} strokeWidth={2} />
        </div>
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
      <Grid cols={3}>
        {#each filteredSkills as skill (skill.id)}
          <SkillCard {skill} />
        {/each}
      </Grid>

      {#if filteredSkills.length === 0 && searchQuery}
        <EmptyState
          title="No matches"
          description={`No skills found matching "${searchQuery}"`}
        >
          {#snippet icon()}
            <HugeiconsIcon icon={Search01Icon} size={40} strokeWidth={1.5} />
          {/snippet}
        </EmptyState>
      {/if}
    {:else}
      <EmptyState
        title="No skills in this category yet"
        description="Skills will appear here once they're classified into this category."
        actionText="Browse Trending"
        actionHref="/trending"
      >
        {#snippet icon()}
          <HugeiconsIcon icon={Sad01Icon} size={40} strokeWidth={1.5} />
        {/snippet}
      </EmptyState>
    {/if}
  </div>
{:else}
  <!-- Not Found -->
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <EmptyState
      title="Category Not Found"
      description="The category you're looking for doesn't exist."
      actionText="Browse Categories"
      actionHref="/categories"
    >
      {#snippet icon()}
        <HugeiconsIcon icon={AlertCircleIcon} size={40} strokeWidth={1.5} />
      {/snippet}
    </EmptyState>
  </div>
{/if}

<style>
  .category-icon-large {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    background: var(--primary-subtle);
    border: 3px solid var(--primary);
    border-radius: var(--radius-xl);
    color: var(--primary);
    flex-shrink: 0;
  }
</style>
