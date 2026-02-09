<script lang="ts">
  import VisibilityBadge from '$lib/components/ui/VisibilityBadge.svelte';

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
    loading?: boolean;
    error?: string | null;
    emptyTitle?: string;
    emptyDescription?: string;
    onRetry?: () => void;
    onUnpublish?: (skill: Skill) => void;
  }

  let {
    skills,
    loading = false,
    error = null,
    emptyTitle = 'No skills yet',
    emptyDescription = 'No skills have been published.',
    onRetry,
    onUnpublish,
  }: Props = $props();

  let searchQuery = $state('');

  const filteredSkills = $derived(
    skills.filter(skill =>
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );
</script>

{#if loading}
  <div class="loading-state">
    <div class="loading-spinner"></div>
    <p>Loading skills...</p>
  </div>
{:else if error}
  <div class="error-state">
    <p>{error}</p>
    {#if onRetry}
      <button class="retry-btn" onclick={onRetry}>Try Again</button>
    {/if}
  </div>
{:else if skills.length === 0}
  <div class="empty-state">
    <svg class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
    <h3>{emptyTitle}</h3>
    <p>{emptyDescription}</p>
  </div>
{:else}
  <!-- Search Box -->
  <div class="search-box">
    <svg class="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search skills..."
      class="search-input"
    />
  </div>

  {#if filteredSkills.length > 0}
    <div class="skills-list">
      {#each filteredSkills as skill (skill.id)}
        <a href="/skills/{skill.slug}" class="skill-card">
          <div class="skill-info">
            <div class="skill-header">
              <h3 class="skill-name">{skill.name}</h3>
              <VisibilityBadge visibility={skill.visibility} />
            </div>
            {#if skill.description}
              <p class="skill-description">{skill.description}</p>
            {/if}
            {#if skill.visibility !== 'private'}
              <div class="skill-meta">
                <span class="stars">
                  <svg class="star-icon" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                  </svg>
                  {skill.stars}
                </span>
              </div>
            {/if}
          </div>
          {#if skill.visibility === 'private' && onUnpublish}
            <button
              class="unpublish-btn"
              title="Unpublish skill"
              onclick={(e) => { e.preventDefault(); e.stopPropagation(); onUnpublish(skill); }}
            >
              <svg class="trash-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          {:else}
            <svg class="chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          {/if}
        </a>
      {/each}
    </div>
  {:else}
    <div class="empty-search">
      <p>No skills match "{searchQuery}"</p>
    </div>
  {/if}
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
    transition: all 0.15s ease;
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
    padding: 1rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s ease;
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
    transition: all 0.15s ease;
  }

  .unpublish-btn:hover {
    color: #ef4444;
    border-color: #ef4444;
    box-shadow: 0 4px 0 0 oklch(45% 0.20 25);
    transform: translateY(-1px);
  }

  .unpublish-btn:active {
    box-shadow: 0 1px 0 0 oklch(45% 0.20 25);
    transform: translateY(2px);
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
    transition: all 0.15s ease;
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

  .empty-search {
    padding: 2rem;
    text-align: center;
    color: var(--muted-foreground);
    background: var(--background);
    border-radius: var(--radius-md);
  }
</style>
