<script lang="ts">
  import { page } from '$app/stores';

  interface Org {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    description: string;
    avatarUrl: string;
    verified: boolean;
    memberCount: number;
    skillCount: number;
    userRole: string | null;
  }

  interface Member {
    userId: string;
    name: string;
    email: string;
    image: string;
    role: string;
    joinedAt: number;
  }

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: string;
    stars: number;
  }

  let org = $state<Org | null>(null);
  let members = $state<Member[]>([]);
  let skills = $state<Skill[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const slug = $derived($page.params.slug);

  $effect(() => {
    if (slug) {
      loadOrg();
    }
  });

  async function loadOrg() {
    loading = true;
    error = null;

    try {
      const [orgRes, membersRes] = await Promise.all([
        fetch(`/api/orgs/${slug}`),
        fetch(`/api/orgs/${slug}/members`),
      ]);

      if (orgRes.ok) {
        const data = await orgRes.json() as { organization?: Org };
        org = data.organization ?? null;
      } else {
        error = 'Organization not found';
        return;
      }

      if (membersRes.ok) {
        const data = await membersRes.json() as { members?: Member[] };
        members = data.members || [];
      }
    } catch {
      error = 'Failed to load organization';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{org?.displayName || slug} - SkillsCat</title>
</svelte:head>

<div class="org-page">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if org}
    <header class="org-header">
      {#if org.avatarUrl}
        <img src={org.avatarUrl} alt={org.name} class="org-avatar" />
      {:else}
        <div class="org-avatar-placeholder">{org.name[0].toUpperCase()}</div>
      {/if}
      <div class="org-info">
        <h1>{org.displayName || org.name}</h1>
        <p class="org-slug">@{org.slug}</p>
        {#if org.description}
          <p class="org-description">{org.description}</p>
        {/if}
        <div class="org-stats">
          <span>{org.memberCount} member{org.memberCount !== 1 ? 's' : ''}</span>
          <span>{org.skillCount} skill{org.skillCount !== 1 ? 's' : ''}</span>
          {#if org.verified}
            <span class="verified">Verified</span>
          {/if}
        </div>
      </div>
    </header>

    <section class="section">
      <h2>Members</h2>
      <div class="member-list">
        {#each members as member}
          <div class="member-card">
            {#if member.image}
              <img src={member.image} alt={member.name} class="member-avatar" />
            {:else}
              <div class="member-avatar-placeholder">{(member.name || 'U')[0]}</div>
            {/if}
            <div class="member-info">
              <div class="member-name">{member.name || 'Unknown'}</div>
              <div class="member-role">{member.role}</div>
            </div>
          </div>
        {/each}
      </div>
    </section>

    {#if org.userRole && ['owner', 'admin'].includes(org.userRole)}
      <section class="section">
        <h2>Settings</h2>
        <div class="settings-actions">
          <button class="btn-secondary">Invite Member</button>
          {#if !org.verified}
            <button class="btn-primary">Verify with GitHub</button>
          {/if}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .org-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .org-header {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 2rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid var(--border);
  }

  .org-avatar, .org-avatar-placeholder {
    width: 80px;
    height: 80px;
    border-radius: 1rem;
    flex-shrink: 0;
  }

  .org-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--primary);
    color: white;
    font-size: 2rem;
    font-weight: 700;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }

  .org-slug {
    color: var(--muted-foreground);
    margin-bottom: 0.5rem;
  }

  .org-description {
    margin-bottom: 0.75rem;
    line-height: 1.5;
  }

  .org-stats {
    display: flex;
    gap: 1rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .verified {
    color: var(--primary);
    font-weight: 500;
  }

  .section {
    margin-bottom: 2rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .member-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }

  .member-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--card);
    border-radius: 0.75rem;
    border: 1px solid var(--border);
  }

  .member-avatar, .member-avatar-placeholder {
    width: 40px;
    height: 40px;
    border-radius: 50%;
  }

  .member-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--muted);
    color: var(--muted-foreground);
    font-weight: 500;
  }

  .member-name {
    font-weight: 500;
  }

  .member-role {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    text-transform: capitalize;
  }

  .settings-actions {
    display: flex;
    gap: 0.75rem;
  }

  .btn-primary, .btn-secondary {
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 500;
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

  .loading, .error {
    text-align: center;
    padding: 4rem;
    color: var(--muted-foreground);
  }

  .error {
    color: #ef4444;
  }
</style>
