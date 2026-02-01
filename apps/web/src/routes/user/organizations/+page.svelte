<script lang="ts">
  import { Button } from '$lib/components';

  interface Org {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    description?: string;
    avatar?: string;
    verified: boolean;
    role: string;
  }

  let orgs = $state<Org[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showCreateDialog = $state(false);
  let creating = $state(false);
  let createError = $state<string | null>(null);
  let newOrgName = $state('');
  let newOrgSlug = $state('');

  $effect(() => {
    loadOrgs();
  });

  async function loadOrgs() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/orgs');
      if (res.ok) {
        const data = await res.json() as { organizations?: Org[] };
        orgs = data.organizations || [];
      } else {
        error = 'Failed to load organizations';
      }
    } catch {
      error = 'Failed to load organizations';
    } finally {
      loading = false;
    }
  }

  async function createOrg() {
    if (!newOrgName.trim() || !newOrgSlug.trim()) return;

    creating = true;
    createError = null;
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newOrgName,
          slug: newOrgSlug,
        }),
      });

      if (res.ok) {
        showCreateDialog = false;
        newOrgName = '';
        newOrgSlug = '';
        createError = null;
        await loadOrgs();
      } else {
        const data = await res.json() as { error?: string; message?: string };
        createError = data.error || data.message || 'Failed to create organization';
      }
    } catch {
      createError = 'Failed to create organization';
    } finally {
      creating = false;
    }
  }

  function generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function handleNameChange(e: Event) {
    const target = e.target as HTMLInputElement;
    newOrgName = target.value;
    newOrgSlug = generateSlug(target.value);
  }
</script>

<svelte:head>
  <title>Organizations - Settings - SkillsCat</title>
</svelte:head>

<div class="orgs-page">
  <div class="page-header">
    <div>
      <h1>Organizations</h1>
      <p class="description">Manage your organizations and team skills.</p>
    </div>
    <Button variant="cute" onclick={() => showCreateDialog = true}>
      Create Organization
    </Button>
  </div>

  {#if loading}
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading organizations...</p>
    </div>
  {:else if error}
    <div class="error-state">
      <p>{error}</p>
      <Button variant="outline" onclick={loadOrgs}>Try Again</Button>
    </div>
  {:else if orgs.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg class="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      </div>
      <h3>No organizations yet</h3>
      <p>Create an organization to collaborate with your team.</p>
      <Button variant="cute" onclick={() => showCreateDialog = true}>
        Create Organization
      </Button>
    </div>
  {:else}
    <div class="orgs-list">
      {#each orgs as org (org.id)}
        <a href="/org/{org.slug}" class="org-card">
          <div class="org-avatar">
            {#if org.avatar}
              <img src={org.avatar} alt={org.displayName || org.name} />
            {:else}
              <span>{(org.displayName || org.name)[0].toUpperCase()}</span>
            {/if}
          </div>
          <div class="org-info">
            <div class="org-header">
              <h3 class="org-name">{org.displayName || org.name}</h3>
              {#if org.verified}
                <span class="verified-badge">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  Verified
                </span>
              {/if}
            </div>
            <p class="org-slug">@{org.slug}</p>
            <span class="org-role">{org.role}</span>
          </div>
          <svg class="chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>
      {/each}
    </div>
  {/if}
</div>

<!-- Create Organization Dialog -->
{#if showCreateDialog}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={() => { showCreateDialog = false; createError = null; }}>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="create-org-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="create-org-title">Create Organization</h2>
      <form onsubmit={(e) => { e.preventDefault(); createOrg(); }}>
        {#if createError}
          <div class="form-error">
            {createError}
          </div>
        {/if}
        <div class="form-group">
          <label for="org-name">Organization Name</label>
          <input
            id="org-name"
            type="text"
            value={newOrgName}
            oninput={handleNameChange}
            placeholder="My Organization"
            disabled={creating}
          />
        </div>
        <div class="form-group">
          <label for="org-slug">URL Slug</label>
          <div class="slug-input">
            <span class="slug-prefix">skillscat.dev/org/</span>
            <input
              id="org-slug"
              type="text"
              bind:value={newOrgSlug}
              placeholder="my-org"
              disabled={creating}
            />
          </div>
        </div>
        <div class="dialog-actions">
          <Button variant="ghost" onclick={() => { showCreateDialog = false; createError = null; }} disabled={creating}>
            Cancel
          </Button>
          <Button variant="cute" disabled={creating || !newOrgName.trim() || !newOrgSlug.trim()}>
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .orgs-page {
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

  .orgs-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .org-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s ease;
  }

  .org-card:hover {
    border-color: var(--primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .org-avatar {
    width: 3rem;
    height: 3rem;
    border-radius: var(--radius-md);
    background: var(--primary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .org-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .org-avatar span {
    color: white;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .org-info {
    flex: 1;
    min-width: 0;
  }

  .org-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.125rem;
  }

  .org-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .verified-badge {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--primary);
  }

  .org-slug {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-bottom: 0.25rem;
  }

  .org-role {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
    text-transform: capitalize;
    background: var(--muted);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-full);
  }

  .chevron {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--muted-foreground);
    flex-shrink: 0;
  }

  /* Dialog */
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .dialog {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    width: 100%;
    max-width: 400px;
  }

  .dialog h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .form-group input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.9375rem;
  }

  .form-group input:focus {
    outline: none;
    border-color: var(--primary);
  }

  .slug-input {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    overflow: hidden;
  }

  .slug-prefix {
    padding: 0.75rem;
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: 0.875rem;
    white-space: nowrap;
  }

  .slug-input input {
    border: none;
    border-radius: 0;
    padding-left: 0.5rem;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .form-error {
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md);
    color: #ef4444;
    font-size: 0.875rem;
  }

  @media (max-width: 640px) {
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
