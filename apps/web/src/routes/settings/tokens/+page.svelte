<script lang="ts">
  interface Token {
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string[];
    lastUsedAt: number | null;
    expiresAt: number | null;
    createdAt: number;
  }

  let tokens = $state<Token[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let newTokenName = $state('');
  let newTokenScopes = $state<string[]>(['read']);
  let createdToken = $state<string | null>(null);
  let creating = $state(false);

  $effect(() => {
    loadTokens();
  });

  async function loadTokens() {
    loading = true;
    try {
      const res = await fetch('/api/tokens');
      if (res.ok) {
        const data = await res.json();
        tokens = data.tokens || [];
      }
    } catch {
      error = 'Failed to load tokens';
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
        }),
      });

      if (res.ok) {
        const data = await res.json();
        createdToken = data.token;
        newTokenName = '';
        await loadTokens();
      } else {
        const data = await res.json();
        error = data.error || 'Failed to create token';
      }
    } catch {
      error = 'Failed to create token';
    } finally {
      creating = false;
    }
  }

  async function revokeToken(id: string) {
    if (!confirm('Are you sure you want to revoke this token?')) return;

    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadTokens();
      }
    } catch {
      error = 'Failed to revoke token';
    }
  }

  function formatDate(timestamp: number | null): string {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleDateString();
  }

  function toggleScope(scope: string) {
    if (newTokenScopes.includes(scope)) {
      newTokenScopes = newTokenScopes.filter(s => s !== scope);
    } else {
      newTokenScopes = [...newTokenScopes, scope];
    }
  }
</script>

<svelte:head>
  <title>API Tokens - SkillsCat</title>
</svelte:head>

<div class="tokens-page">
  <h1>API Tokens</h1>
  <p class="description">
    Create tokens to authenticate with the SkillsCat API and CLI.
  </p>

  {#if createdToken}
    <div class="token-created">
      <h3>Token Created</h3>
      <p>Copy this token now. It will not be shown again.</p>
      <code class="token-value">{createdToken}</code>
      <button onclick={() => { navigator.clipboard.writeText(createdToken!); }}>
        Copy to Clipboard
      </button>
      <button onclick={() => { createdToken = null; }}>Done</button>
    </div>
  {/if}

  <section class="create-section">
    <h2>Create New Token</h2>
    <form onsubmit={(e) => { e.preventDefault(); createToken(); }}>
      <div class="form-group">
        <label for="token-name">Token Name</label>
        <input
          id="token-name"
          type="text"
          bind:value={newTokenName}
          placeholder="My CLI Token"
          disabled={creating}
        />
      </div>

      <div class="form-group">
        <label>Scopes</label>
        <div class="scopes">
          <label class="scope-option">
            <input
              type="checkbox"
              checked={newTokenScopes.includes('read')}
              onchange={() => toggleScope('read')}
            />
            Read (view skills)
          </label>
          <label class="scope-option">
            <input
              type="checkbox"
              checked={newTokenScopes.includes('write')}
              onchange={() => toggleScope('write')}
            />
            Write (manage skills)
          </label>
          <label class="scope-option">
            <input
              type="checkbox"
              checked={newTokenScopes.includes('publish')}
              onchange={() => toggleScope('publish')}
            />
            Publish (upload skills)
          </label>
        </div>
      </div>

      <button type="submit" class="btn-primary" disabled={creating || !newTokenName.trim()}>
        {creating ? 'Creating...' : 'Create Token'}
      </button>
    </form>
  </section>

  <section class="tokens-section">
    <h2>Active Tokens</h2>
    {#if loading}
      <p class="loading">Loading...</p>
    {:else if tokens.length === 0}
      <p class="empty">No active tokens.</p>
    {:else}
      <div class="token-list">
        {#each tokens as token}
          <div class="token-card">
            <div class="token-info">
              <div class="token-name">{token.name}</div>
              <div class="token-meta">
                <span class="token-prefix">{token.tokenPrefix}...</span>
                <span class="token-scopes">{token.scopes.join(', ')}</span>
              </div>
              <div class="token-dates">
                Created: {formatDate(token.createdAt)}
                {#if token.lastUsedAt}
                  | Last used: {formatDate(token.lastUsedAt)}
                {/if}
              </div>
            </div>
            <button class="btn-danger" onclick={() => revokeToken(token.id)}>
              Revoke
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if error}
    <div class="error">{error}</div>
  {/if}
</div>

<style>
  .tokens-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .description {
    color: var(--muted-foreground);
    margin-bottom: 2rem;
  }

  section {
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: var(--card);
    border-radius: 0.75rem;
    border: 1px solid var(--border);
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  input[type="text"] {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--background);
    color: var(--foreground);
  }

  .scopes {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .scope-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: normal;
  }

  .btn-primary {
    padding: 0.75rem 1.5rem;
    background: var(--primary);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger {
    padding: 0.5rem 1rem;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .token-created {
    padding: 1.5rem;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 0.75rem;
    margin-bottom: 2rem;
  }

  .token-created h3 {
    color: #22c55e;
    margin-bottom: 0.5rem;
  }

  .token-value {
    display: block;
    padding: 1rem;
    background: var(--background);
    border-radius: 0.5rem;
    margin: 1rem 0;
    word-break: break-all;
    font-family: monospace;
  }

  .token-created button {
    margin-right: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--card);
    cursor: pointer;
  }

  .token-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .token-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: var(--background);
    border-radius: 0.5rem;
  }

  .token-name {
    font-weight: 500;
    margin-bottom: 0.25rem;
  }

  .token-meta {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .token-prefix {
    font-family: monospace;
  }

  .token-dates {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    margin-top: 0.25rem;
  }

  .loading, .empty {
    color: var(--muted-foreground);
    font-style: italic;
  }

  .error {
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    color: #ef4444;
  }
</style>
