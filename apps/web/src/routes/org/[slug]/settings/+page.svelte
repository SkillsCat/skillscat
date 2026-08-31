<script lang="ts">
  import { page } from '$app/stores';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { getSettingsCopy } from '$lib/i18n/settings';
  import { getUiCopy } from '$lib/i18n/ui';

  interface Org {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    description: string;
    avatarUrl: string;
    githubConnected: boolean;
    verified: boolean;
    skillCount: number;
    userRole: string | null;
  }

  let org = $state<Org | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showDeleteConfirm = $state(false);
  let deleteConfirmText = $state('');
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);
  let connecting = $state(false);
  let connectError = $state<string | null>(null);
  let showEditDialog = $state(false);
  let editDisplayName = $state('');
  let editDescription = $state('');
  let editAvatarUrl = $state('');
  let saving = $state(false);
  let editError = $state<string | null>(null);
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const copy = $derived(getSettingsCopy(i18n.locale()));
  const ui = $derived(getUiCopy(i18n.locale()));

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
          error = messages.orgSettings.orgNotFound;
        }
      } else {
        error = messages.orgSettings.failedToLoadOrganization;
      }
    } catch {
      error = messages.orgSettings.failedToLoadOrganization;
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
        connectError = data.message || copy.orgProfile.connectFailed;
      }
    } catch {
      connectError = copy.orgProfile.connectFailed;
    } finally {
      connecting = false;
    }
  }

  function openEditDialog() {
    if (!org) return;
    editDisplayName = org.displayName || org.name || '';
    editDescription = org.description || '';
    editAvatarUrl = org.avatarUrl || '';
    editError = null;
    showEditDialog = true;
  }

  function closeEditDialog() {
    showEditDialog = false;
    editError = null;
  }

  async function handleSaveProfile() {
    if (!org || saving) return;

    const displayName = editDisplayName.trim();
    if (!displayName) {
      editError = copy.orgProfile.displayNameRequired;
      return;
    }

    saving = true;
    editError = null;
    try {
      const res = await fetch(`/api/orgs/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          // Empty strings clear these optional fields on the server.
          description: editDescription.trim(),
          avatarUrl: editAvatarUrl.trim(),
        }),
      });
      const result = await res.json() as { message?: string };
      if (res.ok) {
        showEditDialog = false;
        await loadOrg();
      } else {
        editError = result.message || copy.orgProfile.updateFailed;
      }
    } catch {
      editError = copy.orgProfile.updateFailed;
    } finally {
      saving = false;
    }
  }

  async function handleDeleteOrg() {
    if (!org || deleteConfirmText !== org.slug) return;

    deleting = true;
    deleteError = null;
    try {
      const res = await fetch(`/api/orgs/${slug}`, { method: 'DELETE' });
      if (res.ok) {
        window.location.href = '/user/organizations';
      } else {
        const result = await res.json() as { message?: string };
        deleteError = result.message || copy.orgProfile.deleteFailed;
      }
    } catch {
      deleteError = copy.orgProfile.deleteFailed;
    } finally {
      deleting = false;
    }
  }
</script>

<div class="profile-page">
  <div class="page-header">
    <h1>{copy.orgProfile.title}</h1>
    <p class="description">{copy.orgProfile.description}</p>
  </div>

  {#if loading}
    <div class="loading-state">
      <div class="loading-spinner"></div>
    </div>
  {:else if error}
    <ErrorState
      title={messages.orgSettings.failedToLoadOrganization}
      message={error}
      primaryActionText={messages.common.tryAgain}
      primaryActionClick={loadOrg}
      secondaryActionText={messages.common.goBack}
      secondaryActionClick={() => history.back()}
    />
  {:else if org}
    <!-- Profile Section -->
    <SettingsSection title={copy.orgProfile.sectionTitle} description={copy.orgProfile.sectionDescription}>
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
              {ui.badges.verified}
            </span>
          {/if}
        </div>
        <div class="profile-actions">
          {#if isOwner}
            <Button variant="ghost" size="sm" onclick={openEditDialog}>
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              {copy.orgProfile.editAction}
            </Button>
          {/if}
          <Button variant="cute" size="sm" href="/org/{slug}">
            {copy.orgProfile.viewPublicProfile}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Button>
        </div>
      </div>
    </SettingsSection>

    <!-- GitHub Connection -->
    <SettingsSection title={copy.orgProfile.githubConnection} description={copy.orgProfile.githubConnectionDescription}>
      {#if org.githubConnected}
        <div class="github-card">
          <div class="github-icon">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </div>
          <div class="github-info">
            <h4>{copy.orgProfile.githubOrganization}</h4>
            <p>{i18n.t(copy.orgProfile.connectedAs, { slug: org.slug })}</p>
          </div>
          <span class="connection-status connected">{ui.badges.connected}</span>
        </div>
      {:else}
        <div class="github-card not-connected">
          <div class="github-icon disconnected">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </div>
          <div class="github-info">
            <h4>{copy.orgProfile.connectTitle}</h4>
            <p>{copy.orgProfile.connectDescription}</p>
            {#if connectError}
              <p class="connect-error">{connectError}</p>
            {/if}
          </div>
          <Button variant="cute" size="sm" onclick={handleConnectGitHub} disabled={connecting}>
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            {connecting ? messages.common.processing : copy.orgProfile.connectAction}
          </Button>
        </div>
      {/if}
    </SettingsSection>

    <!-- Danger Zone (owners only) -->
    {#if isOwner}
      <SettingsSection title={copy.orgProfile.dangerZone} danger>
        <div class="danger-card">
          <div class="danger-info">
            <h4>{copy.orgProfile.deleteOrganization}</h4>
            <p>{copy.orgProfile.deleteOrganizationDescription}</p>
            {#if org.skillCount > 0}
              <p class="delete-blocked">{copy.orgProfile.deleteRequiresNoSkills}</p>
            {/if}
          </div>
          <Button
            variant="danger"
            size="sm"
            onclick={() => { deleteError = null; showDeleteConfirm = true; }}
            disabled={org.skillCount > 0}
          >
            {messages.common.delete}
          </Button>
        </div>
      </SettingsSection>
    {/if}
  {/if}
</div>

<!-- Edit Profile Dialog -->
{#if showEditDialog && org}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={closeEditDialog}>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="edit-dialog-title" class="edit-dialog-title">{copy.orgProfile.editDialogTitle}</h2>
      <div class="form-group">
        <label for="edit-display-name">{copy.orgProfile.displayNameLabel}</label>
        <input
          id="edit-display-name"
          type="text"
          bind:value={editDisplayName}
          placeholder={org.name}
          class="edit-input"
          maxlength="100"
          disabled={saving}
        />
      </div>
      <div class="form-group">
        <label for="edit-description">{copy.orgProfile.descriptionLabel}</label>
        <textarea
          id="edit-description"
          bind:value={editDescription}
          placeholder={copy.orgProfile.descriptionPlaceholder}
          class="edit-input edit-textarea"
          maxlength="500"
          rows="3"
          disabled={saving}
        ></textarea>
      </div>
      <div class="form-group">
        <label for="edit-avatar-url">{copy.orgProfile.avatarUrlLabel}</label>
        <input
          id="edit-avatar-url"
          type="url"
          bind:value={editAvatarUrl}
          placeholder={copy.orgProfile.avatarUrlPlaceholder}
          class="edit-input"
          disabled={saving}
        />
      </div>
      {#if editError}
        <p class="edit-error">{editError}</p>
      {/if}
      <div class="dialog-actions">
        <Button variant="ghost" onclick={closeEditDialog} disabled={saving}>
          {messages.common.cancel}
        </Button>
        <Button variant="cute" onclick={handleSaveProfile} disabled={saving || !editDisplayName.trim()}>
          {saving ? messages.common.processing : copy.orgProfile.saveAction}
        </Button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Confirmation Dialog -->
{#if showDeleteConfirm && org}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={() => showDeleteConfirm = false}>
    <div class="dialog danger-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="delete-dialog-title">{copy.orgProfile.deleteDialogTitle}</h2>
      <p class="dialog-warning">
        {copy.orgProfile.deleteDialogWarning}
      </p>
      <ul class="delete-list">
        <li>{copy.orgProfile.deleteSkills}</li>
        <li>{copy.orgProfile.deleteTokens}</li>
        <li>{copy.orgProfile.deleteMembers}</li>
      </ul>
      <p class="dialog-confirm-text">
        {i18n.t(copy.orgProfile.typeSlugToConfirm, { slug: org.slug })}
      </p>
      <input
        type="text"
        bind:value={deleteConfirmText}
        placeholder={org.slug}
        class="confirm-input"
        disabled={deleting}
      />
      {#if deleteError}
        <p class="delete-error">{deleteError}</p>
      {/if}
      <div class="dialog-actions">
        <Button variant="ghost" onclick={() => { showDeleteConfirm = false; deleteConfirmText = ''; }} disabled={deleting}>
          {messages.common.cancel}
        </Button>
        <button
          class="delete-btn"
          onclick={handleDeleteOrg}
          disabled={deleting || deleteConfirmText !== org.slug}
        >
          {deleting ? messages.common.deleting : copy.orgProfile.deleteOrganization}
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

  .profile-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex-shrink: 0;
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

  .delete-blocked,
  .delete-error {
    color: #ef4444;
    margin-top: 0.5rem;
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

  .dialog h2.edit-dialog-title {
    color: var(--foreground);
  }

  /* Edit Profile Dialog */
  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .edit-input {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.9375rem;
    font-family: inherit;
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transition: all 0.15s ease;
    box-sizing: border-box;
  }

  :global(.dark) .edit-input {
    box-shadow: 0 3px 0 0 oklch(25% 0.02 85);
  }

  .edit-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  .edit-textarea {
    resize: vertical;
    min-height: 4.5rem;
  }

  .edit-error {
    font-size: 0.875rem;
    color: #ef4444;
    margin-bottom: 1rem;
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
