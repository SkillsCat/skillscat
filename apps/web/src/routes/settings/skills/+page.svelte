<script lang="ts">
  import { Button } from '$lib/components';

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: 'public' | 'private' | 'unlisted';
    stars: number;
    createdAt: number;
  }

  let skills = $state<Skill[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    loadSkills();
  });

  async function loadSkills() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/skills?mine=true');
      if (res.ok) {
        const data = await res.json() as { skills?: Skill[] };
        skills = data.skills || [];
      } else {
        error = 'Failed to load skills';
      }
    } catch {
      error = 'Failed to load skills';
    } finally {
      loading = false;
    }
  }

  function getVisibilityColor(visibility: string): string {
    switch (visibility) {
      case 'private': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'unlisted': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      default: return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    }
  }
</script>

<svelte:head>
  <title>My Skills - Settings - SkillsCat</title>
</svelte:head>

<div class="skills-page">
  <div class="page-header">
    <div>
      <h1>My Skills</h1>
      <p class="description">Manage your uploaded and indexed skills.</p>
    </div>
    <Button variant="cute" href="/submit">Upload Skill</Button>
  </div>

  {#if loading}
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading skills...</p>
    </div>
  {:else if error}
    <div class="error-state">
      <p>{error}</p>
      <Button variant="outline" onclick={loadSkills}>Try Again</Button>
    </div>
  {:else if skills.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg class="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <h3>No skills yet</h3>
      <p>Upload your first skill to get started.</p>
      <Button variant="cute" href="/submit">Upload Skill</Button>
    </div>
  {:else}
    <div class="skills-list">
      {#each skills as skill (skill.id)}
        <a href="/skills/{skill.slug}" class="skill-card">
          <div class="skill-info">
            <div class="skill-header">
              <h3 class="skill-name">{skill.name}</h3>
              <span class="visibility-badge {getVisibilityColor(skill.visibility)}">
                {skill.visibility}
              </span>
            </div>
            {#if skill.description}
              <p class="skill-description">{skill.description}</p>
            {/if}
            <div class="skill-meta">
              <span class="stars">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                </svg>
                {skill.stars}
              </span>
            </div>
          </div>
          <svg class="chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .skills-page {
    max-width: 800px;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
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

  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .loading-spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-state {
    color: var(--destructive);
  }

  .error-state p {
    margin-bottom: 1rem;
  }

  .empty-icon {
    color: var(--muted-foreground);
    opacity: 0.5;
    margin-bottom: 1rem;
  }

  .empty-state h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .empty-state p {
    color: var(--muted-foreground);
    margin-bottom: 1.5rem;
  }

  .skills-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skill-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s ease;
  }

  .skill-card:hover {
    border-color: var(--primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
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
    font-size: 1rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .visibility-badge {
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: var(--radius-full);
  }

  .skill-description {
    font-size: 0.875rem;
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
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }

  .stars {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .chevron {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--muted-foreground);
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
