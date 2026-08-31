<script lang="ts">
  import Grid from '$lib/components/layout/Grid.svelte';
  import VisibilityBadge from '$lib/components/ui/VisibilityBadge.svelte';
  import SkillManageDialog from '$lib/components/settings/SkillManageDialog.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { getSettingsCopy } from '$lib/i18n/settings';
  import { buildSkillPath } from '$lib/skill-path';
  import { cleanSkillCardDescription, matchesSkillCardDescription } from '$lib/text/skill-card-description';

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: 'public' | 'private' | 'unlisted';
    stars: number;
  }

  interface Props {
    skills: Skill[];
    layout?: 'list' | 'grid';
    loading?: boolean;
    error?: string | null;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyHint?: string;
    onRetry?: () => void;
    onUnpublish?: (skill: Skill) => void;
    onSkillUpdated?: () => void | Promise<void>;
  }

  let {
    skills,
    layout = 'list',
    loading = false,
    error = null,
    emptyTitle = 'No skills yet',
    emptyDescription = 'No skills have been published.',
    emptyHint,
    onRetry,
    onUnpublish,
    onSkillUpdated,
  }: Props = $props();
  const i18n = useI18n();
  const copy = $derived(getSettingsCopy(i18n.locale()));

  let searchQuery = $state('');
  let manageTarget = $state<Skill | null>(null);

  const filteredSkills = $derived(
    skills.filter(skill =>
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      matchesSkillCardDescription(skill.description, searchQuery)
    )
  );
</script>

{#snippet skillItems()}
  {#each filteredSkills as skill (skill.id)}
    {@const displayDescription = cleanSkillCardDescription(skill.description)}
    <div
      class="skill-card"
      class:skill-card-grid={layout === 'grid'}
    >
      <a href={buildSkillPath(skill.slug)} class="skill-link">
        <div class="skill-info">
          <div class="skill-header">
            <h3 class="skill-name" title={layout === 'grid' ? skill.name : undefined}>{skill.name}</h3>
            <VisibilityBadge visibility={skill.visibility} />
          </div>
          {#if displayDescription}
            <p class="skill-description" title={displayDescription}>{displayDescription}</p>
          {/if}
          {#if skill.visibility !== 'private'}
            <div class="skill-meta">
              <span class="stars">
                <svg class="star-icon" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                </svg>
                {skill.stars}
              </span>
            </div>
          {/if}
        </div>
        {#if !(skill.visibility === 'private' && onUnpublish)}
          <svg class="chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        {/if}
      </a>
      {#if onSkillUpdated || (skill.visibility === 'private' && onUnpublish)}
        <div class="card-actions" class:card-actions-grid={layout === 'grid'}>
          {#if onSkillUpdated}
            <button
              class="manage-btn"
              title={copy.skillManage.manageSkill}
              aria-label={copy.skillManage.manageSkill}
              onclick={() => (manageTarget = skill)}
            >
              <svg class="manage-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          {/if}
          {#if skill.visibility === 'private' && onUnpublish}
            <button
              class="unpublish-btn"
              title={copy.skillsList.unpublishSkill}
              aria-label={copy.skillsList.unpublishSkill}
              onclick={() => onUnpublish(skill)}
            >
              <svg class="trash-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
{/snippet}

{#if loading}
  <div class="loading-state">
    <div class="loading-spinner"></div>
    <p>{copy.skillsList.loading}</p>
  </div>
{:else if error}
  <div class="error-state">
    <p>{error}</p>
    {#if onRetry}
      <button class="retry-btn" onclick={onRetry}>{copy.skillsList.retry}</button>
    {/if}
  </div>
{:else if skills.length === 0}
  <div class="empty-state">
    <svg class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
    <h3>{emptyTitle}</h3>
    <p>{emptyDescription}</p>
    {#if emptyHint}
      <p class="empty-hint">{emptyHint}</p>
    {/if}
  </div>
{:else}
  <!-- Search Box -->
  <div class="search-box">
    <svg class="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      type="text"
      bind:value={searchQuery}
      placeholder={copy.skillsList.searchPlaceholder}
      aria-label={copy.skillsList.searchPlaceholder}
      class="search-input"
    />
  </div>

  {#if filteredSkills.length > 0}
    {#if layout === 'grid'}
      <Grid cols={2} gap="sm">
        {@render skillItems()}
      </Grid>
    {:else}
      <div class="skills-list">
        {@render skillItems()}
      </div>
    {/if}
  {:else}
    <div class="empty-search">
      <p>{i18n.t(copy.skillsList.noMatches, { query: searchQuery })}</p>
      <p class="search-scope-hint">{copy.skillsList.searchScopeHint}</p>
    </div>
  {/if}
{/if}

{#if onSkillUpdated}
  <SkillManageDialog
    skill={manageTarget}
    onClose={() => (manageTarget = null)}
    onVisibilityChanged={onSkillUpdated}
  />
{/if}

<style>
  /* Search Box */
  .search-box {
    position: relative;
    margin-bottom: 1rem;
  }

  .search-icon {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.25rem;
    height: 1.25rem;
    color: var(--muted-foreground);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 0.625rem 1rem 0.625rem 2.75rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.875rem;
    box-shadow: 0 3px 0 0 var(--border);
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }

  .search-input:focus {
    border-color: var(--primary);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
    outline: none;
  }

  .search-input::placeholder {
    color: var(--muted-foreground);
  }

  /* Skills List */
  .skills-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skill-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease;
  }

  .skill-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1;
    min-width: 0;
    padding: 1rem;
    border-radius: calc(var(--radius-md) - 1px);
    color: inherit;
    text-decoration: none;
  }

  .skill-link:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .skill-card-grid {
    min-width: 0;
    min-height: 5.625rem;
    height: 100%;
  }

  .skill-card-grid .skill-link {
    padding: 0.75rem;
  }

  .skill-card-grid .skill-header {
    gap: 0.5rem;
    margin-bottom: 0.125rem;
    min-width: 0;
  }

  .skill-card-grid .skill-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-card-grid .skill-description {
    margin-bottom: 0.375rem;
  }

  .skill-card:hover {
    border-color: var(--primary);
  }

  .skill-info {
    flex: 1;
    min-width: 0;
  }

  .skill-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.25rem;
  }

  .skill-name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .skill-description {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    margin-bottom: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .stars {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    line-height: 1;
  }

  .star-icon {
    width: 0.875rem;
    height: 0.875rem;
    vertical-align: middle;
  }

  .chevron {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--muted-foreground);
    flex-shrink: 0;
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-right: 1rem;
    flex-shrink: 0;
  }

  .card-actions-grid {
    margin-right: 0.75rem;
  }

  .manage-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--background);
    color: var(--muted-foreground);
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: 0 3px 0 0 var(--border);
    transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }

  .manage-btn:hover {
    color: var(--primary);
    border-color: var(--primary);
    box-shadow: 0 4px 0 0 var(--primary);
    transform: translateY(-1px);
  }

  .manage-btn:active {
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  .manage-btn:focus-visible {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .manage-icon {
    width: 1rem;
    height: 1rem;
  }

  .unpublish-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--background);
    color: var(--muted-foreground);
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: 0 3px 0 0 var(--border);
    transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }

  .unpublish-btn:hover {
    color: var(--destructive);
    border-color: var(--destructive);
    box-shadow: 0 4px 0 0 color-mix(in oklch, var(--destructive) 75%, black);
    transform: translateY(-1px);
  }

  .unpublish-btn:active {
    box-shadow: 0 1px 0 0 color-mix(in oklch, var(--destructive) 75%, black);
    transform: translateY(2px);
  }

  .unpublish-btn:focus-visible {
    outline: none;
    border-color: var(--destructive);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .trash-icon {
    width: 1rem;
    height: 1rem;
  }

  /* States */
  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    text-align: center;
    background: var(--background);
    border-radius: var(--radius-md);
  }

  .loading-spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 0.75rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-state {
    color: var(--destructive);
    gap: 0.75rem;
  }

  .retry-btn {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;
  }

  .retry-btn:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .empty-icon {
    width: 3rem;
    height: 3rem;
    color: var(--muted-foreground);
    opacity: 0.5;
    margin-bottom: 0.75rem;
  }

  .empty-state h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--foreground);
  }

  .empty-state p {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .empty-hint {
    margin-top: 0.5rem;
  }

  .empty-search {
    padding: 2rem;
    text-align: center;
    color: var(--muted-foreground);
    background: var(--background);
    border-radius: var(--radius-md);
  }

  .search-scope-hint {
    margin-top: 0.375rem;
    font-size: 0.8125rem;
    opacity: 0.8;
  }
</style>
