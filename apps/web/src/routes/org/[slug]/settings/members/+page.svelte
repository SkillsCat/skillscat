<script lang="ts">
  import { page } from '$app/stores';
  import { Avatar, Button, SettingsSection, ErrorState } from '$lib/components';

  interface Member {
    userId: string;
    name: string;
    email: string;
    image: string;
    role: 'owner' | 'admin' | 'member';
    joinedAt: number;
  }

  interface Org {
    userRole: string | null;
  }

  let members = $state<Member[]>([]);
  let org = $state<Org | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Invite dialog state
  let showInviteDialog = $state(false);
  let inviteUsername = $state('');
  let inviteRole = $state<'admin' | 'member'>('member');
  let inviting = $state(false);
  let inviteError = $state<string | null>(null);
  let inviteSuccess = $state<string | null>(null);

  const slug = $derived($page.params.slug);
  const isOwner = $derived(org?.userRole === 'owner');
  const isAdmin = $derived(org?.userRole === 'owner' || org?.userRole === 'admin');

  $effect(() => {
    if (slug) {
      loadData();
    }
  });

  async function loadData() {
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
      }

      if (membersRes.ok) {
        const data = await membersRes.json() as { members?: Member[] };
        members = data.members || [];
      } else {
        error = 'Failed to load members';
      }
    } catch {
      error = 'Failed to load members';
    } finally {
      loading = false;
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'owner': return 'role-owner';
      case 'admin': return 'role-admin';
      default: return 'role-member';
    }
  }

  function openInviteDialog() {
    inviteUsername = '';
    inviteRole = 'member';
    inviteError = null;
    inviteSuccess = null;
    showInviteDialog = true;
  }

  function closeInviteDialog() {
    showInviteDialog = false;
    inviteUsername = '';
    inviteRole = 'member';
    inviteError = null;
    inviteSuccess = null;
  }

  async function handleInvite() {
    if (!inviteUsername.trim() || inviting) return;

    inviting = true;
    inviteError = null;
    inviteSuccess = null;

    try {
      const res = await fetch(`/api/orgs/${slug}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubUsername: inviteUsername.trim(),
          role: inviteRole,
        }),
      });

      const data = await res.json() as { message?: string };

      if (res.ok) {
        inviteSuccess = data.message || 'Invitation sent successfully';
        inviteUsername = '';
      } else {
        inviteError = data.message || 'Failed to send invitation';
      }
    } catch {
      inviteError = 'Failed to send invitation';
    } finally {
      inviting = false;
    }
  }
</script>

<div class="members-page">
  <div class="page-header">
    <div>
      <h1>Members</h1>
      <p class="description">Manage organization members and their roles.</p>
    </div>
    {#if isAdmin}
      <Button variant="cute" size="sm" onclick={openInviteDialog}>
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Invite Member
      </Button>
    {/if}
  </div>

  <SettingsSection title="Organization Members" description="People who have access to this organization.">
    {#if loading}
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading members...</p>
      </div>
    {:else if error}
      <ErrorState
        title="Failed to Load"
        message={error}
        primaryActionText="Try Again"
        primaryActionClick={loadData}
        secondaryActionText="Go Back"
        secondaryActionClick={() => history.back()}
      />
    {:else if members.length === 0}
      <div class="empty-state">
        <svg class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
        <h3>No members</h3>
        <p>Invite members to collaborate on this organization.</p>
      </div>
    {:else}
      <div class="members-list">
        {#each members as member (member.userId)}
          <div class="member-card">
            <Avatar
              src={member.image}
              alt={member.name}
              fallback={member.name}
              size="md"
              useGithubFallback
            />
            <div class="member-info">
              <div class="member-header">
                <a href="/u/{member.name}" class="member-name">{member.name}</a>
                <span class="role-badge {getRoleBadgeClass(member.role)}">{member.role}</span>
              </div>
              <p class="member-email">{member.email}</p>
              <p class="member-joined">Joined {formatDate(member.joinedAt)}</p>
            </div>
            {#if isOwner && member.role !== 'owner'}
              <div class="member-actions">
                <Button variant="ghost" size="sm">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                  </svg>
                </Button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </SettingsSection>
</div>

<!-- Invite Member Dialog -->
{#if showInviteDialog}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={closeInviteDialog}>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="invite-dialog-title">Invite Member</h2>
      <p class="dialog-description">
        Invite a user by their GitHub username. They will receive a notification to accept or decline.
      </p>

      <div class="form-group">
        <label for="github-username">GitHub Username</label>
        <div class="input-wrapper">
          <span class="input-prefix">@</span>
          <input
            id="github-username"
            type="text"
            bind:value={inviteUsername}
            placeholder="username"
            class="invite-input"
            disabled={inviting}
          />
        </div>
      </div>

      <div class="form-group">
        <label for="invite-role">Role</label>
        <select id="invite-role" bind:value={inviteRole} class="role-select" disabled={inviting}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {#if inviteError}
        <p class="invite-error">{inviteError}</p>
      {/if}

      {#if inviteSuccess}
        <p class="invite-success">{inviteSuccess}</p>
      {/if}

      <div class="dialog-actions">
        <Button variant="ghost" onclick={closeInviteDialog} disabled={inviting}>
          Cancel
        </Button>
        <Button variant="cute" onclick={handleInvite} disabled={inviting || !inviteUsername.trim()}>
          {inviting ? 'Sending...' : 'Send Invitation'}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .members-page {
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

  /* States */
  .loading-state,
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

  /* Members List */
  .members-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .member-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    transition: border-color 0.15s ease;
  }

  .member-card:hover {
    border-color: var(--primary);
  }

  .member-info {
    flex: 1;
    min-width: 0;
  }

  .member-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .member-name {
    font-weight: 600;
    color: var(--foreground);
    text-decoration: none;
  }

  .member-name:hover {
    color: var(--primary);
  }

  .role-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.025em;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-full);
  }

  .role-owner {
    background: var(--primary-subtle);
    color: var(--primary);
  }

  .role-admin {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }

  .role-member {
    background: var(--muted);
    color: var(--muted-foreground);
  }

  .member-email {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    margin-bottom: 0.125rem;
  }

  .member-joined {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .member-actions {
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }

    .member-card {
      flex-direction: column;
      text-align: center;
    }

    .member-header {
      justify-content: center;
    }

    .member-actions {
      margin-top: 0.5rem;
    }
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
    margin-bottom: 0.5rem;
  }

  .dialog-description {
    font-size: 0.875rem;
    color: var(--muted-foreground);
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

  .input-wrapper {
    display: flex;
    align-items: center;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transition: all 0.15s ease;
  }

  .input-wrapper:focus-within {
    border-color: var(--primary);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  .input-prefix {
    padding-left: 0.75rem;
    color: var(--muted-foreground);
    font-weight: 500;
  }

  .invite-input {
    flex: 1;
    padding: 0.75rem;
    padding-left: 0.25rem;
    border: none;
    background: transparent;
    color: var(--foreground);
    font-size: 0.9375rem;
    outline: none;
  }

  .role-select {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.9375rem;
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .role-select:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  .invite-error {
    font-size: 0.875rem;
    color: #ef4444;
    margin-bottom: 1rem;
  }

  .invite-success {
    font-size: 0.875rem;
    color: #22c55e;
    margin-bottom: 1rem;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }
</style>
