<script lang="ts">
  import { page } from '$app/stores';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';

  interface Org {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    description: string;
    avatarUrl: string;
    githubConnected: boolean;
    verified: boolean;
    userRole: string | null;
  }

  let org = $state<Org | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showDeleteConfirm = $state(false);
  let deleteConfirmText = $state('');
  let deleting = $state(false);
  let connecting = $state(false);
  let connectError = $state<string | null>(null);

  const slug = $derived($page.params.slug);
  const isOwner = $derived(org?.userRole === 'owner');

  $effect(() => {
    if (slug) {
      loadOrg();
    }
  });

  async function loadOrg() {
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/orgs/${slug}`);
      if (res.ok) {
        const data = await res.json() as { organization?: Org };
        org = data.organization ?? null;
        if (!org) {
          error = 'Organization not found';
        }
      } else {
        error = 'Failed to load organization';
      }
    } catch {
      error = 'Failed to load organization';
    } finally {
      loading = false;
    }
  }

  async function handleConnectGitHub() {
    if (!org || connecting) return;

    connecting = true;
    connectError = null;
    try {
      const res = await fetch(`/api/orgs/${slug}/verify`, { method: 'POST' });
      const data = await res.json() as { message?: string };
      if (res.ok) {
        await loadOrg();
      } else {
        connectError = data.message || 'Failed to connect GitHub organization';
      }
    } catch {
      connectError = 'Failed to connect GitHub organization';
    } finally {
      connecting = false;
    }
  }

  async function handleDeleteOrg() {
    if (!org || deleteConfirmText !== org.slug) return;

    deleting = true;
    try {
      const res = await fetch(`/api/orgs/${slug}`, { method: 'DELETE' });
      if (res.ok) {
        window.location.href = '/user/organizations';
      }
    } catch {
      // Handle error silently
    } finally {
      deleting = false;
    }
  }
</script>

<div class="profile-page">
  <div class="page-header">
    <h1>Profile</h1>
    <p class="description">Manage your organization's profile and settings.</p>
  </div>

  {#if loading}
    <div class="loading-state">
      <div class="loading-spinner"></div>
    </div>
  {:else if error}
    <ErrorState
      title="Failed to Load"
      message={error}
      primaryActionText="Try Again"
      primaryActionClick={loadOrg}
      secondaryActionText="Go Back"
      secondaryActionClick={() => history.back()}
    />
  {:else if org}
    <!-- Profile Section -->
    <SettingsSection title="Organization Profile" description="Your organization's public information.">
      <div class="profile-card">
        <Avatar
          src={org.avatarUrl}
          alt={org.displayName || org.name}
          fallback={org.slug}
          size="lg"
        />
        <div class="profile-info">
          <h3 class="profile-name">{org.displayName || org.name}</h3>
          <p class="profile-slug">@{org.slug}</p>
          {#if org.description}
            <p class="profile-description">{org.description}</p>
          {/if}
          {#if org.verified}
            <span class="verified-badge">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Verified
            </span>
          {/if}
        </div>
        <Button variant="cute" size="sm" href="/org/{slug}">
          View Public Profile
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </Button>
      </div>
    </SettingsSection>

    <!-- GitHub Connection -->
    <SettingsSection title="GitHub Connection" description="Your organization's GitHub integration.">
      {#if org.githubConnected}
        <div class="github-card">
          <div class="github-icon">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </div>
          <div class="github-info">
            <h4>GitHub Organization</h4>
            <p>Connected as @{org.slug}</p>
          </div>
          <span class="connection-status connected">Connected</span>
        </div>
      {:else}
        <div class="github-card not-connected">
          <div class="github-icon disconnected">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </div>
          <div class="github-info">
            <h4>Connect to GitHub</h4>
            <p>Link a GitHub organization to sync skills and enable verification.</p>
            {#if connectError}
              <p class="connect-error">{connectError}</p>
            {/if}
          </div>
          <Button variant="cute" size="sm" onclick={handleConnectGitHub} disabled={connecting}>
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            {connecting ? 'Connecting...' : 'Connect GitHub'}
          </Button>
        </div>
      {/if}
    </SettingsSection>

    <!-- Danger Zone (owners only) -->
    {#if isOwner}
      <SettingsSection title="Danger Zone" danger>
        <div class="danger-card">
          <div class="danger-info">
            <h4>Delete Organization</h4>
            <p>Permanently delete this organization and all associated data.</p>
          </div>
          <Button variant="danger" size="sm" onclick={() => showDeleteConfirm = true}>
            Delete
          </Button>
        </div>
      </SettingsSection>
    {/if}
  {/if}
</div>

<!-- Delete Confirmation Dialog -->
{#if showDeleteConfirm && org}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={() => showDeleteConfirm = false}>
    <div class="dialog danger-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="delete-dialog-title">Delete Organization</h2>
      <p class="dialog-warning">
        This will permanently delete:
      </p>
      <ul class="delete-list">
        <li>All organization skills</li>
        <li>All API tokens</li>
        <li>All member associations</li>
      </ul>
      <p class="dialog-confirm-text">
        Type the organization slug <strong>{org.slug}</strong> to confirm:
      </p>
      <input
        type="text"
        bind:value={deleteConfirmText}
        placeholder={org.slug}
        class="confirm-input"
        disabled={deleting}
      />
      <div class="dialog-actions">
        <Button variant="ghost" onclick={() => { showDeleteConfirm = false; deleteConfirmText = ''; }} disabled={deleting}>
          Cancel
        </Button>
        <button
          class="delete-btn"
          onclick={handleDeleteOrg}
          disabled={deleting || deleteConfirmText !== org.slug}
        >
          {deleting ? 'Deleting...' : 'Delete Organization'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .profile-page {
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

  .loading-state {
    display: flex;
    justify-content: center;
    padding: 4rem;
  }

  .loading-spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Profile Card */
  .profile-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--background);
    border-radius: var(--radius-md);
  }

  .profile-info {
    flex: 1;
    min-width: 0;
  }

  .profile-name {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 0.125rem;
  }

  .profile-slug {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-bottom: 0.25rem;
  }

  .profile-description {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-bottom: 0.5rem;
  }

  .verified-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--primary);
    background: var(--primary-subtle);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-full);
  }

  /* GitHub Card */
  .github-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--background);
    border-radius: var(--radius-md);
  }

  .github-icon {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    background: #24292e;
    color: white;
    flex-shrink: 0;
  }

  .github-info {
    flex: 1;
  }

  .github-info h4 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 0.125rem;
  }

  .github-info p {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }

  .connect-error {
    color: #ef4444;
    margin-top: 0.5rem;
  }

  .connection-status {
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-full);
  }

  .connection-status.connected {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    border: 2px solid #22c55e;
    box-shadow: 2px 2px 0 0 oklch(55% 0.18 145);
  }

  /* Not Connected State */
  .github-card.not-connected {
    border: 2px dashed var(--border);
    background: var(--muted);
  }

  .github-icon.disconnected {
    background: var(--muted-foreground);
    opacity: 0.5;
  }

  /* Danger Card */
  .danger-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.05);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: var(--radius-md);
  }

  .danger-info {
    flex: 1;
    min-width: 0;
  }

  .danger-info h4 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .danger-info p {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    margin: 0;
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

  .danger-dialog {
    border-color: rgba(239, 68, 68, 0.3);
  }

  .dialog h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: #ef4444;
  }

  .dialog-warning {
    font-size: 0.9375rem;
    margin-bottom: 0.75rem;
  }

  .delete-list {
    margin: 0 0 1rem 1.25rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .delete-list li {
    margin-bottom: 0.25rem;
  }

  .dialog-confirm-text {
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  .confirm-input {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.9375rem;
    margin-bottom: 1rem;
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transition: all 0.15s ease;
  }

  :global(.dark) .confirm-input {
    box-shadow: 0 3px 0 0 oklch(25% 0.02 85);
  }

  .confirm-input:focus {
    outline: none;
    border-color: #ef4444;
    box-shadow: 0 1px 0 0 #ef4444;
    transform: translateY(2px);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .delete-btn {
    padding: 0.625rem 1.25rem;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .delete-btn:hover:not(:disabled) {
    background: #dc2626;
  }

  .delete-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    h1 {
      font-size: 1.375rem;
    }

    .profile-card {
      flex-direction: column;
      text-align: center;
    }

    .github-card {
      flex-direction: column;
      text-align: center;
    }

    .github-card.not-connected {
      text-align: center;
    }

    .danger-card {
      flex-direction: column;
      align-items: stretch;
    }

    .danger-card :global(button) {
      width: 100%;
    }
  }
</style>
