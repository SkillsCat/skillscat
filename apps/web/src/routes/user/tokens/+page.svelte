<script lang="ts">
  import { Checkbox, Select } from 'bits-ui';
  import Button from '$lib/components/ui/Button.svelte';
  import { toast } from '$lib/components/ui/Toast.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { useI18n } from '$lib/i18n/runtime';
  import { getSettingsCopy } from '$lib/i18n/settings';
  import { formatRelativeTimestamp } from '$lib/i18n/relative';
  import { Key01Icon, Delete02Icon, Tick02Icon, Copy01Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons';

  interface Token {
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string[];
    lastUsedAt: number | null;
    expiresAt: number | null;
    createdAt: number;
  }

  interface Scope {
    id: string;
    label: string;
    description: string;
  }

  let tokens = $state<Token[]>([]);
  let loading = $state(true);
  let newTokenName = $state('');
  let newTokenScopes = $state<string[]>(['read']);
  let newTokenExpiration = $state<number | null>(90);
  let createdToken = $state<string | null>(null);
  let creating = $state(false);
  let copiedToken = $state(false);

  // Revoke dialog state
  let showRevokeDialog = $state(false);
  let tokenToRevoke = $state<Token | null>(null);
  let revoking = $state(false);
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const copy = $derived(getSettingsCopy(i18n.locale()));
  const availableScopes = $derived<Scope[]>([
    {
      id: 'read',
      label: copy.tokens.readScopeLabel,
      description: copy.tokens.readScopeDescription,
    },
    {
      id: 'write',
      label: copy.tokens.writeScopeLabel,
      description: copy.tokens.writeScopeDescriptionUser,
    },
    {
      id: 'publish',
      label: copy.tokens.publishScopeLabel,
      description: copy.tokens.publishScopeDescription,
    },
  ]);
  const expirationOptions = $derived([
    { value: 7, label: copy.tokens.expiration7Days },
    { value: 30, label: copy.tokens.expiration30Days },
    { value: 90, label: copy.tokens.expiration90Days },
    { value: 180, label: copy.tokens.expiration180Days },
    { value: 365, label: copy.tokens.expiration1Year },
    { value: null, label: copy.tokens.neverExpires },
  ]);

  $effect(() => {
    loadTokens();
  });

  async function loadTokens() {
    loading = true;
    try {
      const res = await fetch('/api/tokens');
      if (res.ok) {
        const data = await res.json() as { tokens?: Token[] };
        tokens = data.tokens || [];
      }
    } catch {
      toast(copy.tokens.failedToLoad, 'error');
    } finally {
      loading = false;
    }
  }

  async function createToken() {
    if (!newTokenName.trim()) return;

    creating = true;
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTokenName,
          scopes: newTokenScopes,
          expiresInDays: newTokenExpiration,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { token?: string };
        createdToken = data.token ?? null;
        newTokenName = '';
        newTokenScopes = ['read'];
        newTokenExpiration = 90;
        await loadTokens();
      } else {
        const data = await res.json() as { error?: string };
        toast(data.error || copy.tokens.failedToCreate, 'error');
      }
    } catch {
      toast(copy.tokens.failedToCreate, 'error');
    } finally {
      creating = false;
    }
  }

  async function revokeToken(token: Token) {
    tokenToRevoke = token;
    showRevokeDialog = true;
  }

  async function confirmRevoke() {
    if (!tokenToRevoke) return;

    revoking = true;
    try {
      const res = await fetch(`/api/tokens/${tokenToRevoke.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast(copy.tokens.revokedSuccess, 'success');
        showRevokeDialog = false;
        tokenToRevoke = null;
        await loadTokens();
      }
    } catch {
      toast(copy.tokens.failedToRevoke, 'error');
    } finally {
      revoking = false;
    }
  }

  function cancelRevoke() {
    showRevokeDialog = false;
    tokenToRevoke = null;
  }

  function formatDate(timestamp: number | null): string {
    if (!timestamp) return messages.common.never;
    return i18n.formatDate(timestamp, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatRelativeTime(timestamp: number): string {
    return formatRelativeTimestamp(i18n, messages, timestamp);
  }

  function isExpiringSoon(expiresAt: number | null): boolean {
    if (!expiresAt) return false;
    const daysUntilExpiry = (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry <= 7 && daysUntilExpiry > 0;
  }

  function formatExpiration(expiresAt: number | null): string {
    if (!expiresAt) return copy.tokens.neverExpires;
    const now = Date.now();
    if (expiresAt < now) return messages.common.expired;
    const daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= 1) return copy.tokens.expiresToday;
    if (daysUntilExpiry <= 7) return i18n.t(copy.tokens.expiresInDays, { count: daysUntilExpiry });
    return i18n.t(copy.tokens.expiresOn, { date: formatDate(expiresAt) });
  }

  function toggleScope(scope: string) {
    if (newTokenScopes.includes(scope)) {
      newTokenScopes = newTokenScopes.filter(s => s !== scope);
    } else {
      newTokenScopes = [...newTokenScopes, scope];
    }
  }

  async function copyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    copiedToken = true;
    toast(copy.tokens.copiedSuccess, 'success');
    setTimeout(() => copiedToken = false, 2000);
  }
</script>

<svelte:head>
  <title>{copy.tokens.title} - {messages.settingsLayout.title} - SkillsCat</title>
</svelte:head>

<div class="tokens-page">
  <!-- Header -->
  <div class="page-header">
    <div class="header-icon">
      <HugeiconsIcon icon={Key01Icon} size={24} />
    </div>
    <div>
      <h1>{copy.tokens.title}</h1>
      <p class="description">
        {copy.tokens.descriptionUser}
      </p>
    </div>
  </div>

  <!-- Token Created Success -->
  {#if createdToken}
    <div class="token-created-card">
      <div class="success-header">
        <div class="success-icon">
          <HugeiconsIcon icon={Tick02Icon} size={20} />
        </div>
        <div>
          <h3>{copy.tokens.createdTitle}</h3>
          <p>{copy.tokens.createdDescription}</p>
        </div>
      </div>
      <div class="token-display">
        <code>{createdToken}</code>
        <Button variant="cute" size="sm" onclick={copyToken}>
          <HugeiconsIcon icon={copiedToken ? Tick02Icon : Copy01Icon} size={16} />
          {copiedToken ? messages.common.copied : messages.common.copy}
        </Button>
      </div>
      <div class="success-actions">
        <Button variant="cute-secondary" size="sm" onclick={() => { createdToken = null; }}>
          {messages.common.done}
        </Button>
      </div>
    </div>
  {/if}

  <!-- Create Token Form -->
  <section class="create-section">
    <h2>{copy.tokens.createTitleUser}</h2>
    <form onsubmit={(e) => { e.preventDefault(); createToken(); }}>
      <div class="form-group">
        <label for="token-name">{copy.tokens.nameLabel}</label>
        <input
          id="token-name"
          type="text"
          bind:value={newTokenName}
          placeholder={copy.tokens.nameUserPlaceholder}
          disabled={creating}
        />
      </div>

      <div class="form-group">
        <span class="form-label">{copy.tokens.permissions}</span>
        <div class="scopes-grid">
          {#each availableScopes as scope (scope.id)}
            <Checkbox.Root
              checked={newTokenScopes.includes(scope.id)}
              onCheckedChange={() => toggleScope(scope.id)}
              class="scope-checkbox"
            >
              {#snippet children({ checked })}
                <div class="checkbox-indicator" class:checked>
                  {#if checked}
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  {/if}
                </div>
                <div class="scope-content">
                  <span class="scope-label">{scope.label}</span>
                  <span class="scope-description">{scope.description}</span>
                </div>
              {/snippet}
            </Checkbox.Root>
          {/each}
        </div>
      </div>

      <div class="form-group">
        <span class="form-label">{copy.tokens.expiration}</span>
        <Select.Root
          type="single"
          value={String(newTokenExpiration)}
          onValueChange={(v) => { newTokenExpiration = v === 'null' ? null : Number(v); }}
          disabled={creating}
        >
          <Select.Trigger class="select-trigger">
            <span class="select-value">
              {expirationOptions.find(o => String(o.value) === String(newTokenExpiration))?.label || messages.common.selectPlaceholder}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={16} class="select-icon" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content class="select-content" sideOffset={4}>
              {#each expirationOptions as option}
                <Select.Item value={String(option.value)} class="select-item">
                  {option.label}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div class="form-actions">
        <Button variant="cute" type="submit" disabled={creating || !newTokenName.trim() || newTokenScopes.length === 0}>
          {creating ? messages.common.creating : copy.tokens.createAction}
        </Button>
      </div>
    </form>
  </section>

  <!-- Active Tokens -->
  <section class="tokens-section">
    <h2>{copy.tokens.activeTitle}</h2>
    {#if loading}
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>{copy.tokens.loading}</p>
      </div>
    {:else if tokens.length === 0}
      <div class="empty-state">
        <div class="empty-icon">
          <HugeiconsIcon icon={Key01Icon} size={32} />
        </div>
        <p>{copy.tokens.emptyTitle}</p>
        <span class="empty-hint">{copy.tokens.emptyDescription}</span>
      </div>
    {:else}
      <div class="token-list">
        {#each tokens as token (token.id)}
          <div class="token-card">
            <div class="token-info">
              <div class="token-header">
                <span class="token-name">{token.name}</span>
                <code class="token-prefix">{token.tokenPrefix}...</code>
              </div>
              <div class="token-scopes">
                {#each token.scopes as scope}
                  <span class="scope-badge">{scope}</span>
                {/each}
              </div>
              <div class="token-meta">
                <span>{i18n.t(copy.tokens.created, { time: formatRelativeTime(token.createdAt) })}</span>
                {#if token.lastUsedAt}
                  <span class="separator">•</span>
                  <span>{i18n.t(copy.tokens.lastUsed, { time: formatRelativeTime(token.lastUsedAt) })}</span>
                {/if}
                <span class="separator">•</span>
                <span class:expiring-soon={isExpiringSoon(token.expiresAt)}>{formatExpiration(token.expiresAt)}</span>
              </div>
            </div>
            <button class="delete-btn" onclick={() => revokeToken(token)} aria-label={copy.tokens.revokeTitle}>
              <HugeiconsIcon icon={Delete02Icon} size={16} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<!-- Revoke Token Confirmation Dialog -->
<ConfirmDialog
  open={showRevokeDialog}
  title={copy.tokens.revokeTitle}
  description={tokenToRevoke ? i18n.t(copy.tokens.revokeDescription, { name: tokenToRevoke.name }) : ''}
  confirmText={copy.tokens.revokeTitle}
  onConfirm={confirmRevoke}
  onCancel={cancelRevoke}
  loading={revoking}
/>

<style>
  .tokens-page {
    max-width: 700px;
  }

  /* Header */
  .page-header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .header-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-lg);
    color: var(--primary);
    flex-shrink: 0;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
    color: var(--foreground);
  }

  .description {
    color: var(--muted-foreground);
    font-size: 0.9375rem;
  }

  /* Token Created Success - Cute Style */
  .token-created-card {
    padding: 1.5rem;
    background: var(--card);
    border: 3px solid #22c55e;
    border-radius: var(--radius-lg);
    margin-bottom: 2rem;
    box-shadow: 4px 4px 0 0 oklch(55% 0.18 145);
  }

  .success-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .success-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background: #22c55e;
    border-radius: var(--radius-full);
    color: white;
    flex-shrink: 0;
    box-shadow: 2px 2px 0 0 oklch(55% 0.18 145);
  }

  .success-header h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--foreground);
    margin-bottom: 0.125rem;
  }

  .success-header p {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .token-display {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--background);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    margin-bottom: 1rem;
  }

  .token-display code {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--foreground);
    word-break: break-all;
  }

  .success-actions {
    display: flex;
    justify-content: flex-end;
  }

  /* Sections */
  section {
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 1.25rem;
    color: var(--foreground);
  }

  /* Form */
  .form-group {
    margin-bottom: 1.25rem;
  }

  label, .form-label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
  }

  input[type="text"] {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 0.9375rem;
    color: var(--foreground);
    background: var(--background);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transition: all 0.15s ease;
  }

  :global(.dark) input[type="text"] {
    box-shadow: 0 3px 0 0 oklch(25% 0.02 85);
  }

  input[type="text"]:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  input[type="text"]::placeholder {
    color: var(--muted-foreground);
  }

  /* Select Component - Bits UI */
  :global(.select-trigger) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 0.9375rem;
    color: var(--foreground);
    background: var(--background);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transition: all 0.15s ease;
  }

  :global(.select-trigger:hover) {
    border-color: var(--primary);
  }

  :global(.select-trigger[data-state="open"]) {
    border-color: var(--primary);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  :global(.select-trigger[data-disabled]) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .select-value {
    flex: 1;
    text-align: left;
  }

  :global(.select-icon) {
    color: var(--muted-foreground);
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }

  :global(.select-trigger[data-state="open"] .select-icon) {
    transform: rotate(180deg);
  }

  :global(.select-content) {
    width: var(--bits-select-trigger-width);
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 0 0 oklch(75% 0.02 85);
    padding: 0.375rem;
    z-index: 100;
  }

  :global(.select-item) {
    display: flex;
    align-items: center;
    padding: 0.625rem 0.75rem;
    font-size: 0.9375rem;
    color: var(--foreground);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.1s ease;
  }

  :global(.select-item:hover),
  :global(.select-item[data-highlighted]) {
    background: var(--muted);
  }

  :global(.select-item[data-state="checked"]) {
    background: var(--primary-subtle);
    color: var(--primary);
    font-weight: 500;
  }

  /* Dark mode for select */
  :global(:root.dark .select-trigger) {
    box-shadow: 0 3px 0 0 oklch(25% 0.02 85);
  }

  :global(:root.dark .select-content) {
    box-shadow: 0 4px 0 0 oklch(25% 0.02 85);
  }

  /* Scopes Grid */
  .scopes-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  :global(.scope-checkbox) {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: var(--background);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transition: all 0.15s ease;
  }

  :global(.dark .scope-checkbox) {
    box-shadow: 0 3px 0 0 oklch(25% 0.02 85);
  }

  :global(.scope-checkbox:hover) {
    border-color: var(--primary);
  }

  :global(.scope-checkbox[data-state="checked"]) {
    border-color: var(--primary);
    background: var(--primary-subtle);
    box-shadow: 0 3px 0 0 oklch(50% 0.22 55);
  }

  .checkbox-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    margin-top: 0.125rem;
    background: var(--background);
    border: 2px solid var(--border);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .checkbox-indicator.checked {
    background: var(--primary);
    border-color: var(--primary);
    color: white;
  }

  .scope-content {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    text-align: left;
  }

  .scope-label {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--foreground);
    text-align: left;
  }

  .scope-description {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    text-align: left;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  /* Loading & Empty States */
  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    text-align: center;
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
    color: var(--muted-foreground);
    opacity: 0.4;
    margin-bottom: 0.75rem;
  }

  .empty-state p {
    font-weight: 500;
    color: var(--foreground);
    margin-bottom: 0.25rem;
  }

  .empty-hint {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  /* Token List */
  .token-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .token-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    transition: border-color 0.15s ease;
  }

  .token-card:hover {
    border-color: var(--primary);
  }

  .token-info {
    flex: 1;
    min-width: 0;
  }

  .token-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .token-name {
    font-weight: 600;
    color: var(--foreground);
  }

  .token-prefix {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--muted-foreground);
    background: var(--muted);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
  }

  .token-scopes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
  }

  .scope-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.025em;
    color: var(--primary);
    background: var(--primary-subtle);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-full);
  }

  .token-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .separator {
    opacity: 0.5;
  }

  .expiring-soon {
    color: #f59e0b;
    font-weight: 500;
  }

  /* Delete Button - Square */
  .delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    background: var(--background);
    color: var(--destructive);
    border: 2px solid var(--destructive);
    border-radius: var(--radius-md);
    cursor: pointer;
    box-shadow: 0 3px 0 0 oklch(45% 0.20 25);
    transition: all 0.1s ease;
    flex-shrink: 0;
  }

  .delete-btn:hover {
    background: var(--destructive);
    color: white;
    transform: translateY(-2px);
    box-shadow: 0 5px 0 0 oklch(45% 0.20 25);
  }

  .delete-btn:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 0 oklch(45% 0.20 25);
  }

  :global(:root.dark) .delete-btn {
    box-shadow: 0 3px 0 0 oklch(35% 0.18 25);
  }

  :global(:root.dark) .delete-btn:hover {
    box-shadow: 0 5px 0 0 oklch(35% 0.18 25);
  }

  :global(:root.dark) .delete-btn:active {
    box-shadow: 0 1px 0 0 oklch(35% 0.18 25);
  }

  /* Dark mode for success card */
  :global(:root.dark) .token-created-card {
    box-shadow: 4px 4px 0 0 oklch(45% 0.15 145);
  }

  :global(:root.dark) .success-icon {
    box-shadow: 2px 2px 0 0 oklch(45% 0.15 145);
  }

  /* Responsive */
  @media (max-width: 640px) {
    h1 {
      font-size: 1.375rem;
    }

    .header-icon {
      display: none;
    }

    .page-header {
      align-items: flex-start;
    }

    section {
      padding: 1rem;
    }

    .token-display {
      flex-direction: column;
      align-items: stretch;
    }

    .token-card {
      padding: 0.75rem;
      gap: 0.75rem;
    }

    .token-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.375rem;
    }

    .token-meta {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.125rem;
    }

    .separator {
      display: none;
    }

    .form-actions {
      justify-content: stretch;
    }

    .form-actions :global(button) {
      width: 100%;
    }
  }
</style>
