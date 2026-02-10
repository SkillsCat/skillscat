<script lang="ts">
  import SearchBox from '$lib/components/common/SearchBox.svelte';
  import { CATEGORY_SECTIONS, type CategoryWithCount } from '$lib/constants/categories';
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

  interface DynamicCategory {
    slug: string;
    name: string;
    description: string | null;
    type: string;
    skillCount: number;
  }

  interface Props {
    data: {
      categories: CategoryWithCount[];
      dynamicCategories: DynamicCategory[];
    };
  }

  let { data }: Props = $props();

  let searchQuery = $state('');

  // Icon mapping for categories (same as Navbar)
  const categoryIcons: Record<string, any> = {
    // Development
    'code-generation': CodeIcon,
    'refactoring': RefreshIcon,
    'debugging': Bug01Icon,
    'testing': TestTubeIcon,
    'code-review': EyeIcon,
    'git': GitBranchIcon,
    // Backend
    'api': Link01Icon,
    'database': Database01Icon,
    'auth': LockPasswordIcon,
    'caching': Loading01Icon,
    // Frontend
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'animation': SparklesIcon,
    'responsive': SmartPhone01Icon,
    // DevOps
    'ci-cd': FlowIcon,
    'docker': CubeIcon,
    'kubernetes': Settings01Icon,
    'cloud': CloudIcon,
    'monitoring': Activity01Icon,
    // Quality
    'security': SecurityLockIcon,
    'performance': SpeedTrain01Icon,
    'linting': CheckListIcon,
    'types': DocumentCodeIcon,
    // Docs
    'documentation': FileScriptIcon,
    'comments': MessageIcon,
    'i18n': EarthIcon,
    // Data
    'data-processing': DatabaseExportIcon,
    'analytics': Analytics01Icon,
    'scraping': Search01Icon,
    'math': Calculator01Icon,
    // AI
    'prompts': AiChat01Icon,
    'embeddings': AiBrain01Icon,
    'agents': AiGenerativeIcon,
    'ml-ops': AiGenerativeIcon,
    // Productivity
    'automation': WorkflowSquare01Icon,
    'file-ops': Folder01Icon,
    'cli': ConsoleIcon,
    'templates': LayoutIcon,
    // Content
    'writing': Edit01Icon,
    'email': Mail01Icon,
    'social': Share01Icon,
    'seo': Search01Icon,
    // Lifestyle
    'finance': MoneyBag01Icon,
    'web3-crypto': BitcoinIcon,
    'legal': JusticeScale01Icon,
    'academic': MortarboardIcon,
    'game-dev': GameboyIcon
  };

  const filteredCategories = $derived(
    searchQuery
      ? data.categories.filter(
          (c) =>
            c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : data.categories
  );

  const filteredDynamicCategories = $derived(
    searchQuery
      ? data.dynamicCategories.filter(
          (c) =>
            c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (c.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
      : data.dynamicCategories
  );

  // Group categories by section for display
  const groupedCategories = $derived(() => {
    return CATEGORY_SECTIONS.map(section => ({
      ...section,
      categories: section.categories.filter(cat =>
        filteredCategories.some(fc => fc.slug === cat.slug)
      ).map(cat => {
        const found = filteredCategories.find(fc => fc.slug === cat.slug);
        return { ...cat, skillCount: found?.skillCount ?? 0 };
      })
    })).filter(section => section.categories.length > 0);
  });

  const totalCount = $derived(filteredCategories.length + filteredDynamicCategories.length);
</script>

<svelte:head>
  <title>Categories - SkillsCat</title>
  <meta name="description" content="Browse Claude Code skills by category." />
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl md:text-4xl font-bold text-fg mb-2">
      Categories
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
    {totalCount} categories
  </div>

  <!-- Categories Grid - Grouped by Section -->
  {#each groupedCategories() as section}
    <div class="section-group">
      <h2 class="section-title">{section.name}</h2>
      <div class="categories-grid">
        {#each section.categories as category (category.slug)}
          <a
            href="/category/{category.slug}"
            class="category-card group"
          >
            <div class="category-icon-wrapper">
              <HugeiconsIcon icon={categoryIcons[category.slug] || SparklesIcon} size={24} strokeWidth={2} />
            </div>
            <div class="category-content">
              <h3 class="category-title">
                {category.name}
              </h3>
              <p class="category-description">
                {category.description}
              </p>
            </div>
            <span class="category-count">
              {category.skillCount}
            </span>
          </a>
        {/each}
      </div>
    </div>
  {/each}

  <!-- AI-Suggested Categories Section -->
  {#if filteredDynamicCategories.length > 0}
    <div class="section-group">
      <h2 class="section-title">
        Community Suggested
        <span class="section-badge">AI</span>
      </h2>
      <div class="categories-grid">
        {#each filteredDynamicCategories as category (category.slug)}
          <a
            href="/category/{category.slug}"
            class="category-card group"
          >
            <div class="category-icon-wrapper category-icon-dynamic">
              <HugeiconsIcon icon={Tag01Icon} size={24} strokeWidth={2} />
            </div>
            <div class="category-content">
              <h3 class="category-title">
                {category.name}
              </h3>
              <p class="category-description">
                {category.description || 'AI-suggested category'}
              </p>
            </div>
            <span class="category-count">
              {category.skillCount}
            </span>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  {#if totalCount === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <HugeiconsIcon icon={Search01Icon} size={32} strokeWidth={2} />
      </div>
      <p class="empty-text">No categories found matching "{searchQuery}"</p>
    </div>
  {/if}
</div>

<style>
  .section-group {
    margin-bottom: 2.5rem;
  }

  .section-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--foreground);
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--border);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .section-badge {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.125rem 0.375rem;
    background: var(--primary-subtle);
    color: var(--primary);
    border-radius: var(--radius-full);
  }

  .categories-grid {
    display: grid;
    grid-template-columns: repeat(1, 1fr);
    gap: 1rem;
  }

  @media (min-width: 640px) {
    .categories-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 1.25rem;
    }
  }

  @media (min-width: 1024px) {
    .categories-grid {
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
    }
  }

  .category-card {
    --card-shadow-offset: 4px;
    --card-shadow-color: oklch(75% 0.02 85);

    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-xl);
    text-decoration: none;
    box-shadow: 0 var(--card-shadow-offset) 0 0 var(--card-shadow-color);
    transform: translateY(0);
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease,
      border-color 0.15s ease;
  }

  :global(.dark) .category-card {
    --card-shadow-color: oklch(25% 0.02 85);
  }

  .category-card:hover {
    --card-shadow-offset: 6px;
    --card-shadow-color: oklch(50% 0.22 55);
    border-color: var(--primary);
    transform: translateY(-2px);
  }

  :global(.dark) .category-card:hover {
    --card-shadow-color: oklch(40% 0.20 55);
  }

  .category-card:active {
    --card-shadow-offset: 1px;
    transform: translateY(3px);
  }

  .category-icon-wrapper {
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
    transition: all var(--duration-normal) var(--ease-spring);
  }

  .category-card:hover .category-icon-wrapper {
    background: var(--primary);
    color: var(--primary-foreground);
    transform: scale(1.1) rotate(5deg);
  }

  .category-icon-dynamic {
    background: var(--muted);
    border-color: var(--muted-foreground);
    color: var(--muted-foreground);
  }

  .category-card:hover .category-icon-dynamic {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-foreground);
  }

  .category-content {
    flex: 1;
    min-width: 0;
  }

  .category-title {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--foreground);
    margin-bottom: 0.125rem;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .category-card:hover .category-title {
    color: var(--primary);
  }

  .category-description {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .category-count {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.5rem;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--primary);
    background: var(--primary-subtle);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: 4rem 1.5rem;
  }

  .empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 5rem;
    height: 5rem;
    margin-bottom: 1.5rem;
    background: var(--primary-subtle);
    border: 3px solid var(--border-sketch);
    border-radius: 50%;
    color: var(--primary);
    animation: bounce-gentle 2s ease-in-out infinite;
  }

  .empty-text {
    font-size: 1rem;
    color: var(--muted-foreground);
  }

  @keyframes bounce-gentle {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }
</style>
