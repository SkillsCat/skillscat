<script lang="ts">
  import SearchBox from '$lib/components/common/SearchBox.svelte';
  import Grid from '$lib/components/layout/Grid.svelte';
  import SkillCard from '$lib/components/skill/SkillCard.svelte';
  import EmptyState from '$lib/components/feedback/EmptyState.svelte';
  import Pagination from '$lib/components/ui/Pagination.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Search01Icon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';
  import type { Snippet } from 'svelte';

  interface PaginationData {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    baseUrl: string;
  }

  interface Props {
    title: string;
    icon: Snippet;
    description: string;
    skills: SkillCardData[];
    emptyMessage?: string;
    pagination?: PaginationData;
  }

  let { title, icon: titleIcon, description, skills, emptyMessage = 'No skills found', pagination }: Props = $props();
  let searchQuery = $state('');

  const filteredSkills = $derived(
    searchQuery
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
      : skills
  );

  // Calculate display counts
  const showingCount = $derived(filteredSkills.length);
  const totalCount = $derived(pagination ? pagination.totalItems : skills.length);
  const startItem = $derived(pagination ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1 : 1);
  const endItem = $derived(pagination ? Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems) : skills.length);
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="page-title">
      <span class="page-title-icon">
        {@render titleIcon()}
      </span>
      {title}
    </h1>
    <p class="text-fg-muted">{description}</p>
  </div>

  {#if skills.length > 0}
    <!-- Search -->
    <div class="mb-8 max-w-md">
      <SearchBox
        placeholder="Filter skills..."
        bind:value={searchQuery}
      />
    </div>

    <!-- Results count -->
    <div class="mb-6 text-sm text-fg-muted">
      {#if searchQuery}
        Showing {showingCount} of {skills.length} skills on this page
      {:else if pagination}
        Showing {startItem}-{endItem} of {totalCount} skills
      {:else}
        Showing {showingCount} of {totalCount} skills
      {/if}
    </div>

    <!-- Skills Grid -->
    <Grid cols={3}>
      {#each filteredSkills as skill (skill.id)}
        <SkillCard {skill} />
      {/each}
    </Grid>

    {#if filteredSkills.length === 0}
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
    {#if pagination && !searchQuery}
      <Pagination
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        itemsPerPage={pagination.itemsPerPage}
        baseUrl={pagination.baseUrl}
      />
    {/if}
  {:else}
    <EmptyState
      title={emptyMessage}
      description="Skills will appear here once they're indexed."
      actionText="Browse Categories"
      actionHref="/categories"
    >
      {#snippet icon()}
        {#if titleIcon}
          {@render titleIcon()}
        {/if}
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
    margin-bottom: 0.5rem;
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
</style>
