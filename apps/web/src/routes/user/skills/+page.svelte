<script lang="ts">
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SkillsList from '$lib/components/settings/SkillsList.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import Pagination from '$lib/components/ui/Pagination.svelte';
  import Tabs from '$lib/components/ui/Tabs.svelte';
  import { invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';
  import { useI18n } from '$lib/i18n/runtime';
  import { getSettingsCopy } from '$lib/i18n/settings';

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: 'public' | 'private' | 'unlisted';
    stars: number;
    updatedAt: number;
  }

  interface SkillBase {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: 'public' | 'private' | 'unlisted';
    stars: number;
  }

  let { data } = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const copy = $derived(getSettingsCopy(i18n.locale()));

  const pageSkills = $derived(data.skills as Skill[]);
  const pagination = $derived(data.pagination);
  const isSubmittedView = $derived(data.view === 'submitted');
  const totalSubmitted = $derived(data.totalSubmitted as number);
  const sectionTitle = $derived(
    isSubmittedView ? copy.userSkills.indexedSectionTitle : copy.userSkills.sectionTitle
  );
  const sectionDescription = $derived(
    isSubmittedView ? copy.userSkills.indexedSectionDescription : copy.userSkills.sectionDescription
  );
  const emptyTitle = $derived(
    isSubmittedView ? copy.userSkills.indexedEmptyTitle : copy.userSkills.emptyTitle
  );
  const emptyDescription = $derived(
    isSubmittedView ? copy.userSkills.indexedEmptyDescription : copy.userSkills.emptyDescription
  );
  const emptyHint = $derived(isSubmittedView ? copy.userSkills.indexedEmptyHint : undefined);
  const viewTabs = $derived([
    {
      label: copy.userSkills.publishedTab,
      href: '/user/skills',
      active: !isSubmittedView,
    },
    {
      label: copy.userSkills.indexedTab,
      href: '/user/skills?view=submitted',
      active: isSubmittedView,
      count: totalSubmitted,
      ariaLabel: i18n.t(copy.userSkills.indexedTabLabel, { count: totalSubmitted }),
    },
  ]);

  // Infinite scroll state (mobile)
  let allSkills = $state<Skill[]>([]);
  let loadingMore = $state(false);
  let loadMoreError = $state(false);
  let currentMobilePage = $state(1);
  let hasMore = $state(true);
  let isDesktop = $state(true);
  let sentinelEl = $state<HTMLDivElement | null>(null);
  let observer: IntersectionObserver | null = null;
  let pageLoadController: AbortController | null = null;

  // Detect desktop vs mobile
  $effect(() => {
    if (!browser) return;
    const mql = window.matchMedia('(min-width: 769px)');
    isDesktop = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isDesktop = e.matches; };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Reset allSkills when SSR data changes (desktop page navigation)
  $effect(() => {
    pageLoadController?.abort();
    pageLoadController = null;
    loadingMore = false;
    loadMoreError = false;
    allSkills = [...pageSkills];
    currentMobilePage = pagination.currentPage;
    hasMore = pagination.currentPage < pagination.totalPages;

    return () => pageLoadController?.abort();
  });

  // IntersectionObserver for mobile infinite scroll
  $effect(() => {
    if (!browser || isDesktop || !sentinelEl) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loadMoreError) {
          loadNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelEl);
    return () => { observer?.disconnect(); observer = null; };
  });

  async function loadNextPage() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    loadMoreError = false;
    const controller = new AbortController();
    pageLoadController = controller;
    try {
      const nextPage = currentMobilePage + 1;
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: '20',
      });
      if (isSubmittedView) {
        params.set('view', 'submitted');
      }
      const res = await fetch(`/api/user/skills?${params.toString()}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const result = await res.json() as { skills: Skill[]; totalPages: number };
        if (controller.signal.aborted) return;
        allSkills = [...allSkills, ...result.skills];
        currentMobilePage = nextPage;
        hasMore = nextPage < result.totalPages;
      } else if (!controller.signal.aborted) {
        loadMoreError = true;
      }
    } catch {
      if (!controller.signal.aborted) {
        loadMoreError = true;
      }
    } finally {
      if (pageLoadController === controller) {
        pageLoadController = null;
        loadingMore = false;
      }
    }
  }

  function retryLoadMore() {
    loadMoreError = false;
    void loadNextPage();
  }

  const displaySkills = $derived(isDesktop ? pageSkills : allSkills);

  let unpublishTarget = $state<SkillBase | null>(null);
  let unpublishLoading = $state(false);

  function handleUnpublishClick(skill: SkillBase) {
    unpublishTarget = skill;
  }

  async function confirmUnpublish() {
    if (!unpublishTarget) return;
    unpublishLoading = true;
    try {
      const res = await fetch(`/api/skills/${unpublishTarget.slug}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        unpublishTarget = null;
        await invalidateAll();
      }
    } catch {
      // Silently fail
    } finally {
      unpublishLoading = false;
    }
  }

  const unpublishDescription = $derived(
    unpublishTarget
      ? i18n.t(copy.userSkills.unpublishDescription, { name: unpublishTarget.name })
      : ''
  );

  function cancelUnpublish() {
    unpublishTarget = null;
  }
</script>

<svelte:head>
  <title>{copy.userSkills.title} - {messages.settingsLayout.title} - SkillsCat</title>
</svelte:head>

<div class="skills-page">
  <div class="page-header">
    <div class="page-heading">
      <h1>{copy.userSkills.title}</h1>
      <p class="description">{copy.userSkills.description}</p>
    </div>
    <Tabs items={viewTabs} ariaLabel={copy.userSkills.viewSwitcherLabel} />
  </div>

  <!-- CLI Upload Hint (only show when no skills) -->
  {#if !isSubmittedView && displaySkills.length === 0 && pagination.totalItems === 0}
    <div class="cli-hint">
      <div class="cli-hint-icon">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <div class="cli-hint-content">
        <p class="cli-hint-title">{copy.userSkills.cliHintTitle}</p>
        <p class="cli-hint-text">{copy.userSkills.cliHintText}</p>
        <div class="cli-command">
          <code>npx skillscat publish</code>
          <CopyButton text="npx skillscat publish" size="sm" />
        </div>
      </div>
    </div>
  {/if}

  <SettingsSection title={sectionTitle} description={sectionDescription}>
    <SkillsList
      skills={displaySkills}
      loading={false}
      error={null}
      layout="grid"
      {emptyTitle}
      {emptyDescription}
      {emptyHint}
      onUnpublish={isSubmittedView ? undefined : handleUnpublishClick}
      onSkillUpdated={() => invalidateAll()}
    />

    <!-- Desktop: Pagination -->
    {#if pagination.totalPages > 1}
      <div class="desktop-pagination">
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          itemsPerPage={pagination.itemsPerPage}
          baseUrl={pagination.baseUrl}
        />
      </div>
    {/if}

    <!-- Mobile: Infinite scroll sentinel -->
    {#if hasMore && !isDesktop}
      <div class="scroll-sentinel" bind:this={sentinelEl}>
        {#if loadingMore}
          <div class="loading-more">
            <div class="loading-spinner"></div>
          </div>
        {:else if loadMoreError}
          <div class="load-more-error">
            <p>{copy.skillsList.loadMoreFailed}</p>
            <button type="button" class="load-more-retry" onclick={retryLoadMore}>
              {copy.skillsList.retry}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </SettingsSection>
</div>

<ConfirmDialog
  open={!!unpublishTarget}
  title={copy.userSkills.unpublishTitle}
  description={unpublishDescription}
  confirmText={copy.userSkills.unpublishConfirm}
  cancelText={messages.common.cancel}
  danger={true}
  loading={unpublishLoading}
  onConfirm={confirmUnpublish}
  onCancel={cancelUnpublish}
/>

<style>
  .skills-page {
    max-width: 800px;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .page-heading {
    flex: 1;
    min-width: 0;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.25rem;
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
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }

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

  .load-more-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 0;
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }

  .load-more-error p {
    margin: 0;
  }

  .load-more-retry {
    padding: 0.375rem 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--foreground);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;
  }

  .load-more-retry:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .load-more-retry:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--primary-subtle);
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
