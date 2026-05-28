<script lang="ts">
  import { goto } from '$app/navigation';
  import { navigating } from '$app/stores';
  import SearchBox from '$lib/components/common/SearchBox.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
  import Grid from '$lib/components/layout/Grid.svelte';
  import SkillCard from '$lib/components/skill/SkillCard.svelte';
  import Section from '$lib/components/layout/Section.svelte';
  import EmptyState from '$lib/components/feedback/EmptyState.svelte';
  import Pagination from '$lib/components/ui/Pagination.svelte';
  import { CATEGORIES } from '$lib/constants';
  import { localizeCategory } from '$lib/i18n/categories';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
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
    SparklesIcon,
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
    GameboyIcon
  } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';

  interface PaginationData {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    baseUrl: string;
  }

  interface Props {
    data: {
      query: string;
      skills: SkillCardData[];
      matchedCategories: typeof CATEGORIES;
      pagination: PaginationData | null;
    };
  }

  let { data }: Props = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  let searchValue = $state('');
  let viewportColumns = $state(1);
  const preferredPageSize = $derived(Math.ceil(50 / viewportColumns) * viewportColumns);
  const localizedMatchedCategories = $derived(
    data.matchedCategories.map((category) => localizeCategory(category, i18n.locale()))
  );
  const isSearchNavigating = $derived($navigating?.to?.url.pathname === '/search');
  const currentPage = $derived(data.pagination?.currentPage ?? 1);
  const totalSkillCount = $derived(data.pagination?.totalItems ?? data.skills.length);
  const pageRangeStart = $derived(
    data.pagination
      ? (data.pagination.currentPage - 1) * data.pagination.itemsPerPage + 1
      : data.skills.length > 0
        ? 1
        : 0
  );
  const pageRangeEnd = $derived(
    data.pagination
      ? Math.min(data.pagination.currentPage * data.pagination.itemsPerPage, data.pagination.totalItems)
      : data.skills.length
  );

  function buildSearchPath(query: string, page: number = 1, pageSize: number = data.pagination?.itemsPerPage ?? preferredPageSize): string {
    const params = new URLSearchParams({ q: query });
    if (pageSize !== 50) {
      params.set('pageSize', String(pageSize));
    }
    if (page > 1) {
      params.set('page', String(page));
    }
    return `/search?${params.toString()}`;
  }

  const canonicalPath = $derived(
    data.query ? buildSearchPath(data.query, currentPage) : '/search'
  );
  const prevUrl = $derived(
    data.query && data.pagination && data.pagination.currentPage > 1
      ? buildSearchPath(data.query, data.pagination.currentPage - 1)
      : ''
  );
  const nextUrl = $derived(
    data.query && data.pagination && data.pagination.currentPage < data.pagination.totalPages
      ? buildSearchPath(data.query, data.pagination.currentPage + 1)
      : ''
  );

  // Icon mapping for categories
  const categoryIcons: Record<string, typeof GitBranchIcon> = {
    'code-generation': CodeIcon,
    'refactoring': RefreshIcon,
    'debugging': Bug01Icon,
    'testing': TestTubeIcon,
    'code-review': EyeIcon,
    'git': GitBranchIcon,
    'api': Link01Icon,
    'database': Database01Icon,
    'auth': LockPasswordIcon,
    'caching': Loading01Icon,
    design: PaintBrush01Icon,
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'animation': SparklesIcon,
    'responsive': SmartPhone01Icon,
    'ci-cd': FlowIcon,
    'docker': CubeIcon,
    'kubernetes': Settings01Icon,
    'cloud': CloudIcon,
    'monitoring': Activity01Icon,
    'security': SecurityLockIcon,
    'performance': SpeedTrain01Icon,
    'linting': CheckListIcon,
    'types': DocumentCodeIcon,
    'documentation': FileScriptIcon,
    'comments': MessageIcon,
    'i18n': EarthIcon,
    'data-processing': DatabaseExportIcon,
    'analytics': Analytics01Icon,
    'scraping': Search01Icon,
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
    'research': Search01Icon,
    'web3-crypto': BitcoinIcon,
    'legal': JusticeScale01Icon,
    'academic': MortarboardIcon,
    'game-dev': GameboyIcon
  };

  $effect(() => {
    searchValue = data.query;
  });

  $effect(() => {
    if (typeof window === 'undefined') return;

    const mediaQueries = [
      window.matchMedia('(min-width: 1024px)'),
      window.matchMedia('(min-width: 640px)'),
    ] as const;

    const updateColumns = () => {
      viewportColumns = mediaQueries[0].matches ? 3 : mediaQueries[1].matches ? 2 : 1;
    };

    updateColumns();
    for (const mediaQuery of mediaQueries) {
      mediaQuery.addEventListener('change', updateColumns);
    }

    return () => {
      for (const mediaQuery of mediaQueries) {
        mediaQuery.removeEventListener('change', updateColumns);
      }
    };
  });

  $effect(() => {
    if (!data.query || !data.pagination) return;
    if (data.pagination.itemsPerPage === preferredPageSize) return;

    const currentOffset = (data.pagination.currentPage - 1) * data.pagination.itemsPerPage;
    const targetPage = Math.floor(currentOffset / preferredPageSize) + 1;

    void goto(buildSearchPath(data.query, targetPage, preferredPageSize), {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  });

  const pageTitle = $derived(
    data.query
      ? `${i18n.t(messages.searchPage.titleWithQuery, { query: data.query })}${currentPage > 1 ? i18n.t(messages.common.pageSuffix, { page: currentPage }) : ''} - SkillsCat`
      : `${messages.searchPage.title} - SkillsCat`
  );
  const pageDescription = $derived(messages.searchPage.startDescription);

  function handleSearch(newQuery: string) {
    const normalized = newQuery.trim();
    if (!normalized) {
      if (data.query) {
        void goto('/search');
      }
      return;
    }

    if (normalized === data.query && currentPage === 1) {
      return;
    }

    void goto(buildSearchPath(normalized, 1, preferredPageSize));
  }

  function handleCategorySelect(category: { slug: string }) {
    void goto(`/category/${encodeURIComponent(category.slug)}`);
  }
</script>

<SEO
  title={pageTitle}
  description={pageDescription}
  url={canonicalPath}
  noindex
  robots="noindex, follow, noarchive"
  {prevUrl}
  {nextUrl}
  structuredData={null}
/>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
  <div class="mb-8">
    <h1 class="page-title">
      <span class="page-title-icon">
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
      </span>
      {messages.searchPage.title}
    </h1>
    <div class="max-w-xl mt-4">
      <SearchBox
        bind:value={searchValue}
        onSearch={handleSearch}
        onSelectCategory={handleCategorySelect}
        placeholder={messages.searchPage.placeholder}
        isLoading={isSearchNavigating}
      />
    </div>
  </div>

  {#if data.query}
    <div class="search-results-shell" data-loading={isSearchNavigating ? '' : undefined} aria-busy={isSearchNavigating}>
      {#if isSearchNavigating}
        <div class="search-loading-banner" role="status" aria-live="polite">
          <span class="loading-spinner"></span>
          <span>{messages.common.loading}</span>
        </div>
      {/if}

      <div class="summary-row mb-8 text-fg-muted">
        <span>
          {i18n.t(messages.searchPage.summary, {
            skills: totalSkillCount,
            categories: localizedMatchedCategories.length,
            query: data.query,
          })}
        </span>

        {#if totalSkillCount > 0}
          <span class="summary-divider" aria-hidden="true">•</span>
          <span>
            {i18n.t(messages.lists.showingRange, {
              start: pageRangeStart,
              end: pageRangeEnd,
              total: totalSkillCount,
            })}
          </span>
        {/if}
      </div>

      {#if localizedMatchedCategories.length > 0}
        <Section title={messages.searchPage.categoriesSection} class="mb-8">
          <div class="category-chips">
            {#each localizedMatchedCategories as category (category.slug)}
              <a
                href="/category/{category.slug}"
                class="category-chip"
              >
                <span class="category-chip-icon">
                  <HugeiconsIcon icon={categoryIcons[category.slug] || SparklesIcon} size={18} strokeWidth={2} />
                </span>
                <span class="font-medium text-fg">{category.name}</span>
              </a>
            {/each}
          </div>
        </Section>
      {/if}

      {#if data.skills.length > 0}
        <Section title={messages.searchPage.skillsSection}>
          <Grid cols={3}>
            {#each data.skills as skill (skill.id)}
              <SkillCard {skill} />
            {/each}
          </Grid>
        </Section>
      {/if}

      {#if data.skills.length === 0 && data.matchedCategories.length === 0}
        <EmptyState
          title={messages.searchPage.noResultsTitle}
          description={i18n.t(messages.searchPage.noResultsDescription, { query: data.query })}
          actionText={messages.common.browseTrendingSkills}
          actionHref="/trending"
        >
          {#snippet icon()}
            <HugeiconsIcon icon={Search01Icon} size={40} strokeWidth={1.5} />
          {/snippet}
        </EmptyState>
      {/if}

      {#if data.pagination && data.pagination.totalPages > 1}
        <Pagination
          currentPage={data.pagination.currentPage}
          totalPages={data.pagination.totalPages}
          totalItems={data.pagination.totalItems}
          itemsPerPage={data.pagination.itemsPerPage}
          baseUrl={data.pagination.baseUrl}
        />
      {/if}
    </div>
  {:else}
    <EmptyState
      title={messages.searchPage.startTitle}
      description={messages.searchPage.startDescription}
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

  .search-results-shell {
    position: relative;
    transition: opacity 0.18s ease;
  }

  .search-results-shell[data-loading] {
    opacity: 0.6;
    pointer-events: none;
  }

  .search-loading-banner {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 1rem;
    padding: 0.625rem 0.875rem;
    font-size: 0.875rem;
    color: var(--fg-muted);
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 9999px;
    animation: search-page-spin 0.75s linear infinite;
  }

  .summary-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 0.625rem;
    align-items: center;
  }

  .summary-divider {
    color: var(--fg-subtle);
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
    transform: translateY(-1px);
  }

  .category-chip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: var(--primary-subtle);
    border: 1.5px solid var(--primary);
    border-radius: var(--radius-md);
    color: var(--primary);
    flex-shrink: 0;
  }

  @keyframes search-page-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
