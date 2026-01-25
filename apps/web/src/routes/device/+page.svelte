<script lang="ts">
  import { signIn } from '$lib/auth-client';

  interface Props {
    data: {
      user: { id: string; name?: string; email?: string; image?: string } | null;
      deviceInfo: {
        userCode: string;
        clientInfo: { os?: string; hostname?: string; version?: string } | null;
        scopes: string[];
        expiresAt: number;
      } | null;
      error: string | null;
      prefillCode: string | null;
    };
  }

  let { data }: Props = $props();

  let userCode = $state('');
  let loading = $state(false);
  let verifying = $state(false);
  let error = $state<string | null>(null);
  let deviceInfo = $state<Props['data']['deviceInfo']>(null);
  let success = $state(false);
  let denied = $state(false);

  // Initialize state from data on mount
  $effect(() => {
    userCode = data.prefillCode ?? '';
    error = data.error;
    deviceInfo = data.deviceInfo;
  });

  function formatCode(value: string): string {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length <= 4) return clean;
    return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
  }

  function handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    userCode = formatCode(input.value);
  }

  async function verifyCode() {
    if (userCode.replace(/-/g, '').length !== 8) {
      error = 'Please enter a valid 8-character code';
      return;
    }

    verifying = true;
    error = null;

    try {
      const res = await fetch(`/device?code=${encodeURIComponent(userCode)}`);
      const html = await res.text();

      // Reload the page with the code parameter
      window.location.href = `/device?code=${encodeURIComponent(userCode)}`;
    } catch {
      error = 'Failed to verify code';
      verifying = false;
    }
  }

  async function authorize(action: 'approve' | 'deny') {
    loading = true;
    error = null;

    try {
      const res = await fetch('/api/device/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_code: deviceInfo?.userCode ?? userCode,
          action,
        }),
      });

      const result = await res.json() as { success: boolean; error?: string };

      if (result.success) {
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
    const callbackUrl = userCode
      ? `/device?code=${encodeURIComponent(userCode)}`
      : '/device';
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
    if (!deviceInfo?.expiresAt) return '';
    const remaining = deviceInfo.expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    const minutes = Math.floor(remaining / 60000);
    return `${minutes} minute${minutes !== 1 ? 's' : ''} remaining`;
  }
</script>

<svelte:head>
  <title>Authorize Device - SkillsCat</title>
</svelte:head>

<div class="device-page">
  <div class="device-card">
    <div class="logo">
      <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="var(--primary)"/>
        <path d="M8 12h16M8 16h12M8 20h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
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
        <h2>Device Authorized</h2>
        <p>You can close this window and return to your terminal.</p>
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
        <p>The device was not authorized. You can close this window.</p>
      </div>
    {:else if !data.user}
      <!-- Not logged in -->
      <p class="description">
        Sign in to authorize the SkillsCat CLI on your device.
      </p>

      {#if userCode}
        <div class="code-display">
          <span class="code-label">Device Code</span>
          <span class="code-value">{formatCode(userCode)}</span>
        </div>
      {/if}

      <button type="button" onclick={handleSignIn} class="login-button">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
        <span>Sign in with GitHub</span>
      </button>
    {:else if deviceInfo}
      <!-- Logged in with valid code -->
      <p class="description">
        The SkillsCat CLI is requesting access to your account.
      </p>

      <div class="code-display">
        <span class="code-label">Device Code</span>
        <span class="code-value">{deviceInfo.userCode}</span>
        <span class="code-expires">{getTimeRemaining()}</span>
      </div>

      {#if deviceInfo.clientInfo}
        <div class="client-info">
          <h3>Device Information</h3>
          <ul>
            {#if deviceInfo.clientInfo.os}
              <li><strong>OS:</strong> {deviceInfo.clientInfo.os}</li>
            {/if}
            {#if deviceInfo.clientInfo.hostname}
              <li><strong>Host:</strong> {deviceInfo.clientInfo.hostname}</li>
            {/if}
            {#if deviceInfo.clientInfo.version}
              <li><strong>CLI Version:</strong> {deviceInfo.clientInfo.version}</li>
            {/if}
          </ul>
        </div>
      {/if}

      <div class="permissions">
        <h3>Permissions Requested</h3>
        <ul>
          {#each deviceInfo.scopes as scope}
            <li>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 12l2 2 4-4"/>
              </svg>
              {getScopeDescription(scope)}
            </li>
          {/each}
        </ul>
      </div>

      <div class="user-info">
        <span>Authorizing as</span>
        {#if data.user.image}
          <img src={data.user.image} alt="" class="user-avatar" />
        {/if}
        <strong>{data.user.name || data.user.email}</strong>
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <div class="actions">
        <button
          type="button"
          onclick={() => authorize('approve')}
          class="btn-approve"
          disabled={loading}
        >
          {loading ? 'Authorizing...' : 'Authorize'}
        </button>
        <button
          type="button"
          onclick={() => authorize('deny')}
          class="btn-deny"
          disabled={loading}
        >
          Deny
        </button>
      </div>
    {:else}
      <!-- Logged in but no code entered -->
      <p class="description">
        Enter the code displayed in your terminal to authorize the CLI.
      </p>

      <form onsubmit={(e) => { e.preventDefault(); verifyCode(); }}>
        <div class="code-input-wrapper">
          <input
            type="text"
            value={userCode}
            oninput={handleInput}
            placeholder="XXXX-XXXX"
            maxlength="9"
            class="code-input"
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <button type="submit" class="btn-verify" disabled={verifying || userCode.replace(/-/g, '').length !== 8}>
          {verifying ? 'Verifying...' : 'Continue'}
        </button>
      </form>

      <div class="user-info">
        <span>Signed in as</span>
        {#if data.user.image}
          <img src={data.user.image} alt="" class="user-avatar" />
        {/if}
        <strong>{data.user.name || data.user.email}</strong>
      </div>
    {/if}
  </div>
</div>

<style>
  .device-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
    background: var(--background);
  }

  .device-card {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
    background: var(--card);
    border-radius: 1rem;
    border: 1px solid var(--border);
    text-align: center;
  }

  .logo {
    margin-bottom: 1.5rem;
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

  .code-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 1rem;
    background: var(--background);
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .code-label {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .code-value {
    font-size: 1.75rem;
    font-weight: 700;
    font-family: monospace;
    letter-spacing: 0.1em;
  }

  .code-expires {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .code-input-wrapper {
    margin-bottom: 1rem;
  }

  .code-input {
    width: 100%;
    padding: 1rem;
    font-size: 1.5rem;
    font-family: monospace;
    text-align: center;
    letter-spacing: 0.15em;
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    background: var(--background);
    color: var(--foreground);
    text-transform: uppercase;
  }

  .code-input:focus {
    outline: none;
    border-color: var(--primary);
  }

  .client-info, .permissions {
    text-align: left;
    padding: 1rem;
    background: var(--background);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .client-info ul, .permissions ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .client-info li {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    padding: 0.25rem 0;
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

  .user-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
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

  .btn-approve, .btn-deny, .btn-verify {
    flex: 1;
    padding: 0.875rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 0.5rem;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s ease;
  }

  .btn-approve {
    background: var(--primary);
    color: white;
  }

  .btn-deny {
    background: var(--background);
    color: var(--foreground);
    border: 1px solid var(--border);
  }

  .btn-verify {
    width: 100%;
    background: var(--primary);
    color: white;
  }

  .btn-approve:disabled, .btn-deny:disabled, .btn-verify:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .success-state, .denied-state {
    padding: 1rem 0;
  }

  .success-icon {
    color: #22c55e;
    margin-bottom: 0.5rem;
  }

  .denied-icon {
    color: #ef4444;
    margin-bottom: 0.5rem;
  }

  .success-state p, .denied-state p {
    color: var(--muted-foreground);
  }
</style>
