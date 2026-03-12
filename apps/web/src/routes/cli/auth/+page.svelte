<script lang="ts">
  import { signIn } from '$lib/auth-client';

  interface Props {
    data: {
      user: {
        id: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } | null;
      redirectUri: string;
      state: string;
      label: string;
      isValidRedirect: boolean;
    };
  }

  let { data }: Props = $props();

  const initialStatus = $derived(
    !data.isValidRedirect
      ? 'Invalid redirect URL.'
      : !data.state
        ? 'Missing state.'
        : data.user
          ? 'Preparing token…'
          : 'Sign in to create a ClawHub-compatible SkillsCat token for the browser login flow.'
  );
  let status = $state('');
  let token = $state<string | null>(null);
  let didStart = $state(false);

  $effect(() => {
    if (!didStart && !token) {
      status = initialStatus;
    }
  });

  async function finishLogin() {
    status = 'Creating token…';

    try {
      const response = await fetch('/api/tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.label,
          scopes: ['read', 'write', 'publish'],
          expiresInDays: 365,
        }),
      });

      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) {
        status = result.error || 'Failed to create token.';
        return;
      }

      token = result.token;
      status = 'Redirecting back to the CLI…';

      const hash = new URLSearchParams();
      hash.set('token', result.token);
      hash.set('registry', `${window.location.origin}/openclaw`);
      hash.set('state', data.state);
      window.location.assign(`${data.redirectUri}#${hash.toString()}`);
    } catch {
      status = 'Failed to create token.';
    }
  }

  $effect(() => {
    if (didStart) return;
    if (!data.user || !data.isValidRedirect || !data.state) return;
    didStart = true;
    void finishLogin();
  });

  function handleSignIn() {
    signIn.social({
      provider: 'github',
      callbackURL: `${window.location.pathname}${window.location.search}`,
    });
  }
</script>

<svelte:head>
  <title>ClawHub CLI Login - SkillsCat</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="cli-auth-page">
  <div class="card cli-auth-card">
    <p class="cli-auth-eyebrow">ClawHub CLI Compatibility</p>
    <h1>Authorize a ClawHub CLI session</h1>
    <p class="cli-auth-summary">{status}</p>

    {#if token}
      <div class="cli-auth-token">
        <p>If the redirect does not open the CLI, copy this token:</p>
        <code>{token}</code>
      </div>
    {/if}

    {#if !data.user && data.isValidRedirect && data.state}
      <button type="button" class="cli-auth-button" onclick={handleSignIn}>
        Sign in with GitHub
      </button>
    {/if}
  </div>
</div>

<style>
  .cli-auth-page {
    min-height: calc(100vh - 8rem);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem 4rem;
  }

  .cli-auth-card {
    width: min(100%, 32rem);
    display: grid;
    gap: 1rem;
    padding: 2rem;
    border-radius: 1.75rem;
  }

  .cli-auth-eyebrow {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
  }

  h1 {
    margin: 0;
    color: var(--fg);
    font-size: clamp(1.8rem, 4vw, 2.5rem);
    line-height: 1.05;
  }

  .cli-auth-summary,
  .cli-auth-token p {
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.7;
  }

  .cli-auth-token {
    display: grid;
    gap: 0.65rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 1.25rem;
    background: var(--bg-subtle);
  }

  .cli-auth-token code {
    display: block;
    overflow-wrap: anywhere;
    padding: 0.8rem 0.9rem;
    border-radius: 1rem;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 0.86rem;
  }

  .cli-auth-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.9rem;
    padding: 0.7rem 1rem;
    border: 1px solid var(--primary);
    border-radius: 999px;
    background: var(--primary);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }

  .cli-auth-button:hover {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
    transform: translateY(-1px);
  }
</style>
