<script lang="ts">
  import { signIn } from '$lib/auth-client';
  import { Avatar, Button } from '$lib/components';

  interface Props {
    data: {
      user: { id: string; name?: string; email?: string; image?: string } | null;
      cliSession: {
        sessionId: string;
        clientInfo: { os?: string; hostname?: string; version?: string } | null;
        scopes: string[];
        expiresAt: number;
      } | null;
      error: string | null;
      sessionId: string | null;
    };
  }

  let { data }: Props = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);
  let denied = $state(false);

  // Initialize error from data
  $effect(() => {
    error = data.error;
  });

  async function authorize(action: 'approve' | 'deny') {
    if (!data.cliSession) return;

    loading = true;
    error = null;

    try {
      const res = await fetch('/registry/auth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: data.cliSession.sessionId,
          action,
        }),
      });

      const result = await res.json() as { redirect_url?: string; error?: string };

      if (result.redirect_url) {
        // Send callback to CLI as a fetch request (not a redirect)
        try {
          await fetch(result.redirect_url, { mode: 'no-cors' });
        } catch {
          // Ignore fetch errors - the CLI server may close before response
        }

        if (action === 'approve') {
          success = true;
        } else {
          denied = true;
        }
      } else {
        error = result.error || 'Authorization failed';
      }
    } catch {
      error = 'Failed to authorize';
    } finally {
      loading = false;
    }
  }

  function handleSignIn() {
    const callbackUrl = data.sessionId
      ? `/registry/auth/login?session=${encodeURIComponent(data.sessionId)}`
      : '/registry/auth/login';
    signIn.social({
      provider: 'github',
      callbackURL: callbackUrl,
    });
  }

  function getScopeDescription(scope: string): string {
    switch (scope) {
      case 'read': return 'View your skills and favorites';
      case 'write': return 'Manage your skills';
      case 'publish': return 'Publish new skills';
      default: return scope;
    }
  }

  function getTimeRemaining(): string {
    if (!data.cliSession?.expiresAt) return '';
    const remaining = data.cliSession.expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    const minutes = Math.floor(remaining / 60000);
    return `${minutes} minute${minutes !== 1 ? 's' : ''} remaining`;
  }
</script>

<svelte:head>
  <title>Authorize CLI - SkillsCat</title>
</svelte:head>

<div class="cli-auth-page">
  <div class="cli-auth-card">
    <div class="logo-centered">
      <img src="/favicon-256x256.png" alt="SkillsCat" width="128" height="128" />
    </div>

    <h1>Authorize CLI</h1>

    {#if success}
      <div class="success-state">
        <div class="success-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </div>
        <h2>Authorization Successful</h2>
        <p>You can close this tab and return to your terminal.</p>
      </div>
    {:else if denied}
      <div class="denied-state">
        <div class="denied-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M15 9l-6 6M9 9l6 6"/>
          </svg>
        </div>
        <h2>Authorization Denied</h2>
        <p>You can close this tab and return to your terminal.</p>
      </div>
    {:else if !data.user}
      <!-- Not logged in -->
      <p class="description">
        Sign in to authorize the SkillsCat CLI on your device.
      </p>

      <button type="button" onclick={handleSignIn} class="login-button">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
        <span>Sign in with GitHub</span>
      </button>
    {:else if data.cliSession}
      <!-- Logged in with valid session -->
      <p class="description">
        The SkillsCat CLI is requesting access to your account.
      </p>

      <div class="permissions">
        <h3>Permissions Requested</h3>
        <ul>
          {#each data.cliSession.scopes as scope}
            <li>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 12l2 2 4-4"/>
              </svg>
              {getScopeDescription(scope)}
            </li>
          {/each}
        </ul>
      </div>

      <div class="session-expires">
        {getTimeRemaining()}
      </div>

      <div class="user-info">
        <span>Authorizing as</span>
        <Avatar
          src={data.user.image}
          alt={data.user.name || ''}
          fallback={data.user.name || ''}
          size="xs"
          border={false}
          useGithubFallback
        />
        <strong>{data.user.name || data.user.email}</strong>
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <div class="actions">
        <Button variant="cute" onclick={() => authorize('approve')} disabled={loading}>
          {loading ? 'Authorizing...' : 'Authorize'}
        </Button>
        <Button variant="outline" onclick={() => authorize('deny')} disabled={loading}>
          Deny
        </Button>
      </div>
    {:else}
      <!-- Logged in but no valid session -->
      <p class="description">
        No valid authorization session found.
      </p>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <p class="hint">
        Please run <code>skillscat login</code> in your terminal to start a new authorization.
      </p>

      <div class="user-info">
        <span>Signed in as</span>
        <Avatar
          src={data.user.image}
          alt={data.user.name || ''}
          fallback={data.user.name || ''}
          size="xs"
          border={false}
          useGithubFallback
        />
        <strong>{data.user.name || data.user.email}</strong>
      </div>
    {/if}
  </div>
</div>

<style>
  .cli-auth-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
    background: var(--background);
  }

  .cli-auth-card {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
    background: var(--card);
    border-radius: 1rem;
    border: 1px solid var(--border);
    text-align: center;
  }

  .logo-centered {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .logo-centered img {
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem;
  }

  h3 {
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    text-align: left;
  }

  .description {
    color: var(--muted-foreground);
    margin-bottom: 1.5rem;
  }

  .permissions {
    text-align: left;
    padding: 1rem;
    background: var(--background);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .permissions ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .permissions li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    padding: 0.25rem 0;
  }

  .permissions svg {
    color: var(--primary);
    flex-shrink: 0;
  }

  .session-expires {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    margin-bottom: 1rem;
  }

  .user-info {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .login-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.875rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 9999px;
    cursor: pointer;
    border: none;
    background-color: #24292e;
    color: white;
    box-shadow: 0 4px 0 0 #0d1117;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }

  .login-button:hover {
    background-color: #2d333b;
    transform: translateY(-2px);
    box-shadow: 0 6px 0 0 #0d1117;
  }

  .login-button:active {
    transform: translateY(2px);
    box-shadow: 0 2px 0 0 #0d1117;
  }

  .login-button svg {
    width: 20px;
    height: 20px;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .actions :global(.btn) {
    flex: 1;
  }

  .error {
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    color: #ef4444;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .hint {
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }

  .hint code {
    background: var(--background);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: monospace;
  }

  .success-state, .denied-state {
    padding: 1rem 0;
  }

  .success-icon {
    color: #22c55e;
    margin-bottom: 0.5rem;
    display: flex;
    justify-content: center;
  }

  .denied-icon {
    color: #ef4444;
    margin-bottom: 0.5rem;
    display: flex;
    justify-content: center;
  }

  .success-state p, .denied-state p {
    color: var(--muted-foreground);
  }
</style>
