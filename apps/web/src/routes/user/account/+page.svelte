<script lang="ts">
  import { Button } from '$lib/components';
  import { useSession, signOut } from '$lib/auth-client';

  const session = useSession();

  let showDeleteConfirm = $state(false);
  let deleteConfirmText = $state('');
  let deleting = $state(false);

  async function handleDeleteAccount() {
    if (!$session.data?.user?.name || deleteConfirmText !== $session.data.user.name) return;

    deleting = true;
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      if (res.ok) {
        signOut();
      }
    } catch {
      // Handle error silently
    } finally {
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>Account - Settings - SkillsCat</title>
</svelte:head>

<div class="account-page">
  <div class="page-header">
    <h1>Account</h1>
    <p class="description">Manage your account settings and connected services.</p>
  </div>

  <!-- Profile Section -->
  <section class="section">
    <h2>Profile</h2>
    {#if $session.data?.user}
      <div class="profile-card">
        <img
          src={$session.data.user.image || `https://avatars.githubusercontent.com/${$session.data.user.name}?s=160`}
          alt={$session.data.user.name || 'User'}
          class="profile-avatar"
        />
        <div class="profile-info">
          <h3 class="profile-name">{$session.data.user.name}</h3>
          <p class="profile-email">{$session.data.user.email}</p>
          <a href="/u/{$session.data.user.name}" class="profile-link">
            View Public Profile
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    {/if}
  </section>

  <!-- Connected Accounts -->
  <section class="section">
    <h2>Connected Accounts</h2>
    <p class="section-description">
      Accounts connected to your SkillsCat profile.
    </p>
    <div class="connected-accounts">
      <div class="account-item">
        <div class="account-icon github">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </div>
        <div class="account-info">
          <h4>GitHub</h4>
          <p>Connected as @{$session.data?.user?.name}</p>
        </div>
        <span class="account-status connected">Connected</span>
      </div>
    </div>
  </section>

  <!-- Danger Zone -->
  <section class="section danger-section">
    <h2>Danger Zone</h2>
    <div class="danger-card">
      <div class="danger-info">
        <h4>Delete Account</h4>
        <p>
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
      </div>
      <Button variant="danger" onclick={() => showDeleteConfirm = true}>
        Delete Account
      </Button>
    </div>
  </section>
</div>

<!-- Delete Confirmation Dialog -->
{#if showDeleteConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={() => showDeleteConfirm = false}>
    <div class="dialog danger-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="delete-dialog-title">Delete Account</h2>
      <p class="dialog-warning">
        This will permanently delete:
      </p>
      <ul class="delete-list">
        <li>Your API tokens and sessions</li>
        <li>Your favorites and preferences</li>
        <li>Your private skills</li>
        <li>Your organization memberships</li>
      </ul>
      <p class="dialog-note">
        <strong>Note:</strong> Your public skills will remain visible but unlinked from your account. If you sign in again with the same GitHub account, they will be restored to your account.
      </p>
      <p class="dialog-confirm-text">
        Type your username <strong>{$session.data?.user?.name}</strong> to confirm:
      </p>
      <input
        type="text"
        bind:value={deleteConfirmText}
        placeholder={$session.data?.user?.name || ''}
        class="confirm-input"
        disabled={deleting}
      />
      <div class="dialog-actions">
        <Button variant="ghost" onclick={() => { showDeleteConfirm = false; deleteConfirmText = ''; }} disabled={deleting}>
          Cancel
        </Button>
        <button
          class="delete-btn"
          onclick={handleDeleteAccount}
          disabled={deleting || deleteConfirmText !== $session.data?.user?.name}
        >
          {deleting ? 'Deleting...' : 'Delete Account'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .account-page {
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

  .section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .section h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .section-description {
    color: var(--muted-foreground);
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .profile-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--background);
    border-radius: var(--radius-md);
  }

  .profile-avatar {
    width: 4rem;
    height: 4rem;
    border-radius: 50%;
    border: 2px solid var(--border);
  }

  .profile-name {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 0.125rem;
  }

  .profile-email {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .profile-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--primary);
    text-decoration: none;
    transition: opacity 0.15s ease;
  }

  .profile-link:hover {
    opacity: 0.8;
  }

  .connected-accounts {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .account-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--background);
    border-radius: var(--radius-md);
  }

  .account-icon {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .account-icon.github {
    background: #24292e;
    color: white;
  }

  .account-info {
    flex: 1;
  }

  .account-info h4 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 0.125rem;
  }

  .account-info p {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }

  .account-status {
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-full);
  }

  .account-status.connected {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
  }

  .danger-section {
    border-color: rgba(239, 68, 68, 0.3);
  }

  .danger-section h2 {
    color: #ef4444;
  }

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

  .danger-info h4 {
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .danger-info p {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
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

  .dialog-note {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    background: var(--muted);
    padding: 0.75rem;
    border-radius: var(--radius-md);
    margin-bottom: 1rem;
    line-height: 1.5;
  }

  .dialog-note strong {
    color: var(--foreground);
  }

  .dialog-confirm-text {
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  .confirm-input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.9375rem;
    margin-bottom: 1rem;
  }

  .confirm-input:focus {
    outline: none;
    border-color: #ef4444;
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
    .danger-card {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
