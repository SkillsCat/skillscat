<script lang="ts">
  import { page } from '$app/stores';

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: string;
    stars: number;
    createdAt: number;
  }

  interface Token {
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string[];
    lastUsedAt: number | null;
    createdAt: number;
  }

  interface Org {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    verified: boolean;
    role: string;
  }

  let skills = $state<Skill[]>([]);
  let tokens = $state<Token[]>([]);
  let orgs = $state<Org[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    loadData();
  });

  async function loadData() {
    loading = true;
    error = null;

    try {
      const [skillsRes, tokensRes, orgsRes] = await Promise.all([
        fetch('/api/skills?mine=true'),
        fetch('/api/tokens'),
        fetch('/api/orgs'),
      ]);

      if (skillsRes.ok) {
        const data = await skillsRes.json() as { skills?: Skill[] };
        skills = data.skills || [];
      }

      if (tokensRes.ok) {
        const data = await tokensRes.json() as { tokens?: Token[] };
        tokens = data.tokens || [];
      }

      if (orgsRes.ok) {
        const data = await orgsRes.json() as { organizations?: Org[] };
        orgs = data.organizations || [];
      }
    } catch (e) {
      error = 'Failed to load dashboard data';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Dashboard - SkillsCat</title>
</svelte:head>

<div class="dashboard">
  <h1>Dashboard</h1>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <section class="section">
      <div class="section-header">
        <h2>My Skills</h2>
        <a href="/submit" class="btn-primary">Upload Skill</a>
      </div>
      {#if skills.length === 0}
        <p class="empty">No skills yet. Upload your first skill!</p>
      {:else}
        <div class="skill-list">
          {#each skills as skill}
            <a href="/skills/{skill.slug}" class="skill-card">
              <div class="skill-name">{skill.name}</div>
              <div class="skill-meta">
                <span class="visibility">{skill.visibility}</span>
                <span class="stars">{skill.stars} stars</span>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </section>

    <section class="section">
      <div class="section-header">
        <h2>API Tokens</h2>
        <a href="/settings/tokens" class="btn-secondary">Manage Tokens</a>
      </div>
      <p class="token-count">{tokens.length} active token{tokens.length !== 1 ? 's' : ''}</p>
    </section>

    <section class="section">
      <div class="section-header">
        <h2>Organizations</h2>
        <button class="btn-secondary">Create Organization</button>
      </div>
      {#if orgs.length === 0}
        <p class="empty">Not a member of any organizations.</p>
      {:else}
        <div class="org-list">
          {#each orgs as org}
            <a href="/org/{org.slug}" class="org-card">
              <div class="org-name">{org.displayName || org.name}</div>
              <div class="org-meta">
                <span class="role">{org.role}</span>
                {#if org.verified}
                  <span class="verified">Verified</span>
                {/if}
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .dashboard {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 2rem;
  }

  .section {
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: var(--card);
    border-radius: 0.75rem;
    border: 1px solid var(--border);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .btn-primary, .btn-secondary {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    border: none;
  }

  .btn-primary {
    background: var(--primary);
    color: white;
  }

  .btn-secondary {
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
  }

  .empty {
    color: var(--muted-foreground);
    font-style: italic;
  }

  .skill-list, .org-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skill-card, .org-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: var(--background);
    border-radius: 0.5rem;
    text-decoration: none;
    color: inherit;
    transition: background 0.15s;
  }

  .skill-card:hover, .org-card:hover {
    background: var(--card-hover);
  }

  .skill-name, .org-name {
    font-weight: 500;
  }

  .skill-meta, .org-meta {
    display: flex;
    gap: 0.75rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .visibility, .role {
    text-transform: capitalize;
  }

  .verified {
    color: var(--primary);
  }

  .token-count {
    color: var(--muted-foreground);
  }

  .loading, .error {
    text-align: center;
    padding: 2rem;
    color: var(--muted-foreground);
  }

  .error {
    color: #ef4444;
  }
</style>
