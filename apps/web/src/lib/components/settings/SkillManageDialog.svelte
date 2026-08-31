<script lang="ts">
  /**
   * SkillManageDialog - Visibility switching and share permission management
   * for a skill the caller can write to. Used by SkillsList.
   */
  import Button from '$lib/components/ui/Button.svelte';
  import VisibilityBadge from '$lib/components/ui/VisibilityBadge.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { getSettingsCopy } from '$lib/i18n/settings';

  type Visibility = 'public' | 'private' | 'unlisted';

  interface ManageableSkill {
    id: string;
    name: string;
    visibility: Visibility;
  }

  interface SharePermission {
    id: string;
    granteeType: string;
    granteeId: string;
    permission: string;
    createdAt: number;
    expiresAt: number | null;
  }

  interface Props {
    skill: ManageableSkill | null;
    onClose: () => void;
    onVisibilityChanged?: () => void | Promise<void>;
  }

  let { skill, onClose, onVisibilityChanged }: Props = $props();

  const i18n = useI18n();
  const copy = $derived(getSettingsCopy(i18n.locale()));

  const VISIBILITIES: Visibility[] = ['public', 'unlisted', 'private'];
  const EXPIRY_OPTIONS = [0, 7, 30, 90, 365] as const;

  let currentVisibility = $state<Visibility>('private');
  let updatingVisibility = $state(false);
  let visibilityError = $state<string | null>(null);
  let repoUrl = $state('');
  let showRepoUrl = $state(false);

  let shares = $state<SharePermission[]>([]);
  let sharesLoading = $state(false);
  let sharesError = $state<string | null>(null);
  let shareEmail = $state('');
  let sharePermission = $state<'read' | 'write'>('read');
  let shareExpiryDays = $state<number>(0);
  let addingShare = $state(false);
  let shareFormError = $state<string | null>(null);
  let revokingKey = $state<string | null>(null);

  function expiryLabel(days: number): string {
    const labels: Record<number, string> = {
      0: copy.skillManage.expiresNever,
      7: copy.skillManage.expires7Days,
      30: copy.skillManage.expires30Days,
      90: copy.skillManage.expires90Days,
      365: copy.skillManage.expires365Days,
    };
    return labels[days] ?? copy.skillManage.expiresNever;
  }

  function formatExpiry(expiresAt: number | null): string {
    if (!expiresAt) return copy.skillManage.expiresNever;
    const date = i18n.formatDate(expiresAt, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return i18n.t(copy.skillManage.expiresOn, { date });
  }

  async function readErrorMessage(res: Response, fallback: string): Promise<string> {
    try {
      const data = (await res.json()) as { message?: string };
      return data.message || fallback;
    } catch {
      return fallback;
    }
  }

  async function loadShares(skillId: string) {
    sharesLoading = true;
    sharesError = null;
    try {
      const res = await fetch(`/api/skills/${skillId}/share`);
      if (res.ok) {
        const data = (await res.json()) as { permissions?: SharePermission[] };
        shares = data.permissions || [];
      } else {
        sharesError = await readErrorMessage(res, copy.skillManage.shareLoadFailed);
      }
    } catch {
      sharesError = copy.skillManage.shareLoadFailed;
    } finally {
      sharesLoading = false;
    }
  }

  async function selectVisibility(next: Visibility) {
    if (!skill || next === currentVisibility || updatingVisibility) return;
    updatingVisibility = true;
    visibilityError = null;
    try {
      const body: { visibility: Visibility; repoUrl?: string } = { visibility: next };
      if (next === 'public' && showRepoUrl && repoUrl.trim()) {
        body.repoUrl = repoUrl.trim();
      }
      const res = await fetch(`/api/skills/${skill.id}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        currentVisibility = next;
        showRepoUrl = false;
        repoUrl = '';
        await onVisibilityChanged?.();
      } else {
        visibilityError = await readErrorMessage(res, copy.skillManage.visibilityUpdateFailed);
        if (next === 'public' && /repository url/i.test(visibilityError)) {
          showRepoUrl = true;
        }
      }
    } catch {
      visibilityError = copy.skillManage.visibilityUpdateFailed;
    } finally {
      updatingVisibility = false;
    }
  }

  async function addShare() {
    if (!skill || addingShare) return;
    const email = shareEmail.trim().toLowerCase();
    if (!email) return;
    addingShare = true;
    shareFormError = null;
    try {
      const body: { email: string; permission: string; expiresInDays?: number } = {
        email,
        permission: sharePermission,
      };
      if (shareExpiryDays > 0) {
        body.expiresInDays = shareExpiryDays;
      }
      const res = await fetch(`/api/skills/${skill.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        shareEmail = '';
        await loadShares(skill.id);
      } else {
        shareFormError = await readErrorMessage(res, copy.skillManage.addShareFailed);
      }
    } catch {
      shareFormError = copy.skillManage.addShareFailed;
    } finally {
      addingShare = false;
    }
  }

  async function revokeShare(permission: SharePermission) {
    if (!skill || revokingKey) return;
    revokingKey = permission.id;
    shareFormError = null;
    try {
      const body = permission.granteeType === 'user'
        ? { userId: permission.granteeId }
        : { email: permission.granteeId };
      const res = await fetch(`/api/skills/${skill.id}/share`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        shares = shares.filter((item) => item.id !== permission.id);
      } else {
        shareFormError = await readErrorMessage(res, copy.skillManage.revokeFailed);
      }
    } catch {
      shareFormError = copy.skillManage.revokeFailed;
    } finally {
      revokingKey = null;
    }
  }

  $effect(() => {
    const skillId = skill?.id;
    if (!skill || !skillId) return;
    currentVisibility = skill.visibility;
    updatingVisibility = false;
    visibilityError = null;
    repoUrl = '';
    showRepoUrl = false;
    shares = [];
    shareEmail = '';
    sharePermission = 'read';
    shareExpiryDays = 0;
    shareFormError = null;
    revokingKey = null;
    void loadShares(skillId);
  });
</script>

{#if skill}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={onClose}>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-manage-dialog-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="dialog-header">
        <h2 id="skill-manage-dialog-title">{copy.skillManage.dialogTitle}</h2>
        <span class="skill-name" title={skill.name}>{skill.name}</span>
      </div>

      <section class="dialog-section">
        <h3>{copy.skillManage.visibilityTitle}</h3>
        <p class="section-hint">{copy.skillManage.visibilityHint}</p>
        <div class="visibility-options" role="radiogroup" aria-label={copy.skillManage.visibilityTitle}>
          {#each VISIBILITIES as option (option)}
            <button
              type="button"
              class="visibility-option"
              class:selected={option === currentVisibility}
              role="radio"
              aria-checked={option === currentVisibility}
              disabled={updatingVisibility}
              onclick={() => selectVisibility(option)}
            >
              <VisibilityBadge visibility={option} />
            </button>
          {/each}
        </div>
        {#if showRepoUrl}
          <div class="repo-url-field">
            <label for="skill-manage-repo-url">{copy.skillManage.repoUrlLabel}</label>
            <input
              id="skill-manage-repo-url"
              type="url"
              bind:value={repoUrl}
              placeholder={copy.skillManage.repoUrlPlaceholder}
              disabled={updatingVisibility}
            />
            <p class="section-hint">{copy.skillManage.repoUrlRequired}</p>
          </div>
        {/if}
        {#if updatingVisibility}
          <p class="section-hint">{copy.skillManage.visibilityUpdating}</p>
        {/if}
        {#if visibilityError}
          <p class="error-message">{visibilityError}</p>
        {/if}
      </section>

      <section class="dialog-section">
        <h3>{copy.skillManage.shareTitle}</h3>
        {#if currentVisibility === 'public'}
          <p class="section-hint">{copy.skillManage.sharePublicHint}</p>
        {:else}
          <p class="section-hint">{copy.skillManage.shareHint}</p>

          {#if sharesLoading}
            <p class="section-hint">{copy.skillManage.shareLoading}</p>
          {:else if sharesError}
            <p class="error-message">{sharesError}</p>
          {:else if shares.length === 0}
            <p class="section-hint">{copy.skillManage.shareEmpty}</p>
          {:else}
            <ul class="share-list">
              {#each shares as permission (permission.id)}
                <li class="share-item">
                  <div class="share-info">
                    <span class="share-grantee" title={permission.granteeId}>{permission.granteeId}</span>
                    <span class="share-meta">
                      {permission.permission === 'write' ? copy.skillManage.permissionWrite : copy.skillManage.permissionRead}
                      · {formatExpiry(permission.expiresAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="revoke-btn"
                    aria-label={i18n.t(copy.skillManage.revokeShare, { id: permission.granteeId })}
                    disabled={revokingKey === permission.id}
                    onclick={() => revokeShare(permission)}
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <form class="share-form" onsubmit={(e) => { e.preventDefault(); void addShare(); }}>
            <label class="sr-only" for="skill-manage-share-email">{copy.skillManage.emailLabel}</label>
            <input
              id="skill-manage-share-email"
              type="email"
              bind:value={shareEmail}
              placeholder={copy.skillManage.shareEmailPlaceholder}
              disabled={addingShare}
              required
            />
            <label class="sr-only" for="skill-manage-share-permission">{copy.skillManage.permissionLabel}</label>
            <select id="skill-manage-share-permission" bind:value={sharePermission} disabled={addingShare}>
              <option value="read">{copy.skillManage.permissionRead}</option>
              <option value="write">{copy.skillManage.permissionWrite}</option>
            </select>
            <label class="sr-only" for="skill-manage-share-expiry">{copy.skillManage.expirationLabel}</label>
            <select id="skill-manage-share-expiry" bind:value={shareExpiryDays} disabled={addingShare}>
              {#each EXPIRY_OPTIONS as days (days)}
                <option value={days}>{expiryLabel(days)}</option>
              {/each}
            </select>
            <Button variant="cute" size="sm" type="submit" disabled={addingShare || !shareEmail.trim()}>
              {addingShare ? copy.skillManage.addingShare : copy.skillManage.addShare}
            </Button>
          </form>
          {#if shareFormError}
            <p class="error-message">{shareFormError}</p>
          {/if}
        {/if}
      </section>

      <div class="dialog-actions">
        <Button variant="ghost" onclick={onClose}>{copy.skillManage.close}</Button>
      </div>
    </div>
  </div>
{/if}

<style>
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
    max-width: 480px;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
  }

  .dialog-header {
    margin-bottom: 1.25rem;
  }

  .dialog-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .skill-name {
    display: block;
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-top: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dialog-section {
    margin-bottom: 1.25rem;
  }

  .dialog-section h3 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--foreground);
    margin-bottom: 0.25rem;
  }

  .section-hint {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    margin-bottom: 0.5rem;
  }

  .visibility-options {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .visibility-option {
    padding: 0.25rem;
    border: 2px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .visibility-option:hover:not(:disabled) {
    border-color: var(--border);
  }

  .visibility-option.selected {
    border-color: var(--primary);
  }

  .visibility-option:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .visibility-option:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .repo-url-field {
    margin-top: 0.75rem;
  }

  .repo-url-field label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--foreground);
    margin-bottom: 0.375rem;
  }

  .repo-url-field input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    margin-bottom: 0.375rem;
  }

  .repo-url-field input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .share-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .share-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .share-info {
    flex: 1;
    min-width: 0;
  }

  .share-grantee {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .share-meta {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .revoke-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--background);
    color: var(--muted-foreground);
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .revoke-btn:hover:not(:disabled) {
    color: var(--destructive);
    border-color: var(--destructive);
  }

  .revoke-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .revoke-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .share-form {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .share-form input[type='email'] {
    flex: 1;
    min-width: 10rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .share-form input[type='email']:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .share-form select {
    padding: 0.5rem 0.5rem;
    font-size: 0.8125rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .error-message {
    font-size: 0.8125rem;
    color: var(--error);
    margin-top: 0.5rem;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
