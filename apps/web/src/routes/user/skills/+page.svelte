<script lang="ts">
  import { CopyButton, SettingsSection, SkillsList } from '$lib/components';

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
  </div>

  <!-- CLI Upload Hint (only show when no skills) -->
  {#if !loading && skills.length === 0}
    <div class="cli-hint">
      <div class="cli-hint-icon">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <div class="cli-hint-content">
        <p class="cli-hint-title">Upload skills via CLI</p>
        <p class="cli-hint-text">Use the SkillsCat CLI to publish your skills:</p>
        <div class="cli-command">
          <code>npx skillscat publish</code>
          <CopyButton text="npx skillscat publish" size="sm" />
        </div>
      </div>
    </div>
  {/if}

  <SettingsSection title="Your Skills" description="Skills you have published to SkillsCat.">
    <SkillsList
      {skills}
      {loading}
      {error}
      emptyTitle="No skills yet"
      emptyDescription="Use the CLI above to publish your first skill."
      onRetry={loadSkills}
    />
  </SettingsSection>
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
    margin-bottom: 1.5rem;
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
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
