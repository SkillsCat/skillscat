<script lang="ts">
  import SearchBox from '$lib/components/common/SearchBox.svelte';
  import Grid from '$lib/components/layout/Grid.svelte';
  import SkillCard from '$lib/components/skill/SkillCard.svelte';
  import EmptyState from '$lib/components/feedback/EmptyState.svelte';
  import Pagination from '$lib/components/ui/Pagination.svelte';
  import type { Category } from '$lib/constants/categories';
  import type { SkillCardData } from '$lib/types';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
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
    AlertCircleIcon,
    CloudIcon,
    FlowIcon,
    SmartPhone01Icon,
    AiGenerativeIcon,
    AiBrain01Icon,
    AiChat01Icon,
    Mail01Icon,
    Share01Icon,
    Edit01Icon,
    MessageIcon,
    LockPasswordIcon,
    Loading01Icon,
    Analytics01Icon,
    ConsoleIcon,
    DocumentCodeIcon,
    LayoutIcon,
    CheckListIcon,
    CubeIcon,
    MoneyBag01Icon,
    BitcoinIcon,
    JusticeScale01Icon,
    MortarboardIcon,
    GameboyIcon,
    Calculator01Icon,
    Tag01Icon
  } from '@hugeicons/core-free-icons';

  interface PaginationData {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    baseUrl: string;
  }

  interface Props {
    data: {
      category: Category | null;
      skills: SkillCardData[];
      pagination: PaginationData | null;
      isDynamic: boolean;
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
    'auth': LockPasswordIcon,
    'caching': Loading01Icon,
    'data-processing': DatabaseExportIcon,
    'analytics': Analytics01Icon,
    'scraping': Search01Icon,
    'math': Calculator01Icon,
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'animation': SparklesIcon,
    'responsive': SmartPhone01Icon,
    'ci-cd': FlowIcon,
    'docker': CubeIcon,
    'kubernetes': Settings01Icon,
    'cloud': CloudIcon,
    'monitoring': Activity01Icon,
    'linting': CheckListIcon,
    'types': DocumentCodeIcon,
    'comments': MessageIcon,
    'prompts': AiChat01Icon,
    'embeddings': AiBrain01Icon,
    'agents': AiGenerativeIcon,
    'ml-ops': AiGenerativeIcon,
    'automation': WorkflowSquare01Icon,
    'file-ops': Folder01Icon,
    'cli': ConsoleIcon,
    'templates': LayoutIcon,
    'writing': Edit01Icon,
    'email': Mail01Icon,
    'social': Share01Icon,
    'seo': Search01Icon,
    'finance': MoneyBag01Icon,
    'web3-crypto': BitcoinIcon,
    'legal': JusticeScale01Icon,
    'academic': MortarboardIcon,
    'game-dev': GameboyIcon,
    'productivity': SparklesIcon
  };

  // Get icon for category, use Tag01Icon for dynamic categories without predefined icon
  const getCategoryIcon = (slug: string, isDynamic: boolean) => {
    if (categoryIcons[slug]) {
      return categoryIcons[slug];
    }
    return isDynamic ? Tag01Icon : SparklesIcon;
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

  // Calculate display counts
  const startItem = $derived(data.pagination ? (data.pagination.currentPage - 1) * data.pagination.itemsPerPage + 1 : 1);
  const endItem = $derived(data.pagination ? Math.min(data.pagination.currentPage * data.pagination.itemsPerPage, data.pagination.totalItems) : data.skills.length);
</script>

<svelte:head>
  {#if data.category}
    <title>{data.category.name} Skills{data.pagination && data.pagination.currentPage > 1 ? ` - Page ${data.pagination.currentPage}` : ''} - SkillsCat</title>
    <meta name="description" content="{data.category.description}. Browse Claude Code skills in this category." />
  {:else}
    <title>Category Not Found - SkillsCat</title>
  {/if}
</svelte:head>

{#if data.category}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
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
    <div class="category-header">
      <div class="category-title-row">
        <div class="category-icon-large" class:category-icon-dynamic={data.isDynamic}>
          <HugeiconsIcon
            icon={getCategoryIcon(data.category.slug, data.isDynamic)}
            size={32}
            strokeWidth={2}
          />
        </div>
        <div class="category-heading-content">
          <h1 class="category-heading">
            {data.category.name}
          </h1>
          {#if data.isDynamic}
            <span class="dynamic-badge">AI Suggested</span>
          {/if}
        </div>
      </div>
      <p class="category-header-description">{data.category.description}</p>
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
        {#if searchQuery}
          Showing {filteredSkills.length} of {data.skills.length} skills on this page
        {:else if data.pagination}
          Showing {startItem}-{endItem} of {data.pagination.totalItems} skills
        {:else}
          Showing {filteredSkills.length} of {data.skills.length} skills
        {/if}
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

      <!-- Pagination -->
      {#if data.pagination && !searchQuery}
        <Pagination
          currentPage={data.pagination.currentPage}
          totalPages={data.pagination.totalPages}
          totalItems={data.pagination.totalItems}
          itemsPerPage={data.pagination.itemsPerPage}
          baseUrl={data.pagination.baseUrl}
        />
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
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
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
  .category-header {
    margin-bottom: 1.5rem;
  }

  .category-title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .category-heading-content {
    min-width: 0;
    flex: 1;
  }

  .category-heading {
    margin: 0;
    font-size: clamp(1.5rem, 7vw, 2.125rem);
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: -0.015em;
    color: var(--foreground);
    word-break: break-word;
  }

  .category-header-description {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--muted-foreground);
  }

  .category-icon-large {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-lg);
    color: var(--primary);
    flex-shrink: 0;
  }

  .category-icon-large :global(svg) {
    width: 1.5rem;
    height: 1.5rem;
  }

  .category-icon-dynamic {
    background: var(--muted);
    border-color: var(--muted-foreground);
    color: var(--muted-foreground);
  }

  .dynamic-badge {
    display: inline-block;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.125rem 0.5rem;
    background: var(--primary-subtle);
    color: var(--primary);
    border-radius: var(--radius-full);
    margin-top: 0.25rem;
  }

  @media (min-width: 640px) {
    .category-header {
      margin-bottom: 2rem;
    }

    .category-title-row {
      align-items: center;
      gap: 1rem;
      margin-bottom: 0.625rem;
    }

    .category-heading {
      font-size: clamp(2rem, 4vw, 2.5rem);
    }

    .category-header-description {
      font-size: 1rem;
    }

    .category-icon-large {
      width: 4rem;
      height: 4rem;
      border-width: 3px;
      border-radius: var(--radius-xl);
    }

    .category-icon-large :global(svg) {
      width: 2rem;
      height: 2rem;
    }
  }
</style>
