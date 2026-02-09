<script lang="ts">
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SkillsList from '$lib/components/settings/SkillsList.svelte';
  import Pagination from '$lib/components/ui/Pagination.svelte';

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: 'public' | 'private' | 'unlisted';
    stars: number;
  }

  const ITEMS_PER_PAGE = 20;

  let skills = $state<Skill[]>([]);
  let allSkills = $state<Skill[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let totalItems = $state(0);
  let totalPages = $state(0);
  let currentPage = $state(1);
  let loadingMore = $state(false);
  let hasMore = $state(true);
  let isDesktop = $state(true);
  let sentinelEl = $state<HTMLDivElement | null>(null);
  let observer: IntersectionObserver | null = null;

  const slug = $derived($page.params.slug);

  // Detect desktop vs mobile
  $effect(() => {
    if (!browser) return;
    const mql = window.matchMedia('(min-width: 768px)');
    isDesktop = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isDesktop = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Load skills on slug change or page param change (desktop)
  $effect(() => {
    if (slug) {
      const pageParam = $page.url.searchParams.get('page');
      const p = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1;
      loadSkills(p);
    }
  });

  // IntersectionObserver for mobile infinite scroll
  $effect(() => {
    if (!browser || isDesktop || !sentinelEl) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loading) {
          loadNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelEl);
    return () => { observer?.disconnect(); observer = null; };
  });

  async function loadSkills(page: number = 1) {
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/orgs/${slug}/skills?page=${page}&limit=${ITEMS_PER_PAGE}`);
      if (res.ok) {
        const data = await res.json() as { skills?: Skill[]; total?: number; totalPages?: number; page?: number };
        skills = data.skills || [];
        totalItems = data.total ?? skills.length;
        totalPages = data.totalPages ?? Math.ceil(totalItems / ITEMS_PER_PAGE);
        currentPage = data.page ?? page;
        // Reset accumulated skills for mobile
        allSkills = [...skills];
        hasMore = currentPage < totalPages;
      } else {
        error = 'Failed to load skills';
      }
    } catch {
      error = 'Failed to load skills';
    } finally {
      loading = false;
    }
  }

  async function loadNextPage() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const nextPage = currentPage + 1;
      const res = await fetch(`/api/orgs/${slug}/skills?page=${nextPage}&limit=${ITEMS_PER_PAGE}`);
      if (res.ok) {
        const data = await res.json() as { skills?: Skill[]; totalPages?: number };
        const newSkills = data.skills || [];
        allSkills = [...allSkills, ...newSkills];
        currentPage = nextPage;
        hasMore = nextPage < (data.totalPages ?? totalPages);
      }
    } catch {
      // Silently fail
    } finally {
      loadingMore = false;
    }
  }

  const displaySkills = $derived(isDesktop ? skills : allSkills);
</script>

<div class="skills-page">
  <div class="page-header">
    <h1>Skills</h1>
    <p class="description">Manage skills published by this organization.</p>
  </div>

  <!-- CLI Upload Hint -->
  {#if !loading && displaySkills.length === 0 && totalItems === 0}
    <div class="cli-hint">
      <div class="cli-hint-icon">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <div class="cli-hint-content">
        <p class="cli-hint-title">Publish skills via CLI</p>
        <p class="cli-hint-text">Use the SkillsCat CLI to publish skills for this organization:</p>
        <div class="cli-command">
          <code>npx skillscat publish --org {slug}</code>
          <CopyButton text="npx skillscat publish --org {slug}" size="sm" />
        </div>
      </div>
    </div>
  {/if}

  <SettingsSection title="Organization Skills" description="Skills published under this organization.">
    <SkillsList
      skills={displaySkills}
      {loading}
      {error}
      emptyTitle="No skills yet"
      emptyDescription="Use the CLI above to publish your first skill."
      onRetry={() => loadSkills(currentPage)}
    />

    <!-- Desktop: Pagination -->
    {#if totalPages > 1}
      <div class="desktop-pagination">
        <Pagination
          {currentPage}
          {totalPages}
          {totalItems}
          itemsPerPage={ITEMS_PER_PAGE}
          baseUrl={`/org/${slug}/settings/skills`}
        />
      </div>
    {/if}

    <!-- Mobile: Infinite scroll sentinel -->
    {#if hasMore && !isDesktop && !loading}
      <div class="scroll-sentinel" bind:this={sentinelEl}>
        {#if loadingMore}
          <div class="loading-more">
            <div class="loading-spinner"></div>
          </div>
        {/if}
      </div>
    {/if}
  </SettingsSection>
</div>

<style>
  .skills-page {
    max-width: 800px;
  }

  .page-header {
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }

  .description {
    color: var(--muted-foreground);
    font-size: 0.9375rem;
  }

  /* CLI Hint */
  .cli-hint {
    display: flex;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-lg);
    margin-bottom: 1.5rem;
  }

  .cli-hint-icon {
    display: flex;
    align-items: flex-start;
    padding-top: 0.125rem;
    color: var(--primary);
    flex-shrink: 0;
  }

  .cli-hint-content {
    flex: 1;
    min-width: 0;
  }

  .cli-hint-title {
    font-weight: 600;
    color: var(--foreground);
    margin-bottom: 0.25rem;
  }

  .cli-hint-text {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
  }

  .cli-command {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: fit-content;
  }

  .cli-command code {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--foreground);
  }

  @media (max-width: 640px) {
    h1 {
      font-size: 1.375rem;
    }
  }

  @media (max-width: 768px) {
    .cli-hint {
      display: none;
    }

    .desktop-pagination {
      display: none;
    }
  }

  @media (min-width: 769px) {
    .scroll-sentinel {
      display: none;
    }
  }

  .loading-more {
    display: flex;
    justify-content: center;
    padding: 1.5rem 0;
  }

  .loading-spinner {
    width: 1.5rem;
    height: 1.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
