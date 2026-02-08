import pc from 'picocolors';
import { setToken, setTokens, isAuthenticated, getUser, getBaseUrl, getClientInfo, generateRandomState, generateCodeVerifier, computeCodeChallenge, initAuthSession, exchangeCodeForTokens, validateAccessToken } from '../utils/auth/auth';
import { startCallbackServer } from '../utils/auth/callback-server';
import { getRegistryUrl } from '../utils/config/config';
import { spinner, success, error, info, warn, box } from '../utils/core/ui';

interface LoginOptions {
  token?: string;
}

export async function login(options: LoginOptions): Promise<void> {
  const baseUrl = getBaseUrl();
  const registryUrl = getRegistryUrl();

  // If token is provided directly, use it
  if (options.token) {
    const sp = spinner('Validating token...');
    try {
      const user = await validateAccessToken(options.token);
      if (!user) {
        sp.stop(false);
        error('Invalid token. Please check your token and try again.');
        process.exit(1);
      }

      setToken(options.token, user);
      sp.stop(true);
      success('Successfully logged in with API token.');
      return;
    } catch {
      sp.stop(false);
      error('Failed to validate token. Please check your internet connection.');
      process.exit(1);
    }
  }

  // Check if already authenticated
  if (isAuthenticated()) {
    const user = getUser();
    warn(`Already logged in${user?.name ? ` as ${user.name}` : ''}.`);
    info('Run `skillscat logout` to sign out first.');
    return;
  }

  // OAuth-style callback flow
  let initSpinner = spinner('Starting authorization...');

  // Step 1: Generate state, PKCE verifier/challenge, and start local callback server
  const state = generateRandomState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  let callbackServer;

  try {
    callbackServer = await startCallbackServer(state);
  } catch (err) {
    initSpinner.stop(false);
    error('Failed to start local server for authorization.');
    info('Please ensure ports 9876-9886 are available.');
    process.exit(1);
  }

  const callbackUrl = `http://localhost:${callbackServer.port}/callback`;
  const clientInfo = getClientInfo();

  // Step 2: Initialize auth session with server (including PKCE)
  let session;
  try {
    session = await initAuthSession(registryUrl, callbackUrl, state, clientInfo, {
      codeChallenge,
      codeChallengeMethod: 'S256',
    });
    initSpinner.stop(true);
  } catch (err) {
    initSpinner.stop(false);
    callbackServer.close();
    error('Failed to initialize authorization session.');
    if (err instanceof Error) {
      console.log(pc.dim(`Error: ${err.message}`));
    }
    process.exit(1);
  }

  // Step 3: Open browser to authorization page
  const authUrl = `${registryUrl}/auth/login?session=${encodeURIComponent(session.session_id)}`;

  console.log();
  box(authUrl, 'Authorize in Browser');
  console.log();

  // Try to open browser
  const { exec } = await import('child_process');
  const platformName = process.platform;
  const openCommand = platformName === 'darwin' ? 'open' :
                      platformName === 'win32' ? 'start' : 'xdg-open';

  exec(`${openCommand} "${authUrl}"`, (err) => {
    if (!err) {
      info('Browser opened automatically');
    }
  });

  const waitSpinner = spinner('Waiting for authorization... (Press Ctrl+C to cancel)');

  // Handle Ctrl+C gracefully
  let cancelled = false;
  const cleanup = () => {
    cancelled = true;
    waitSpinner.stop(false);
    callbackServer.close();
    console.log();
    warn('Authorization cancelled.');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);

  // Step 4: Wait for callback
  try {
    const result = await callbackServer.waitForCallback();
    waitSpinner.stop(true);

    // Step 5: Exchange code for tokens (with PKCE verifier)
    const exchangeSpinner = spinner('Exchanging authorization code...');

    const tokens = await exchangeCodeForTokens(registryUrl, result.code, session.session_id, codeVerifier);

    const now = Date.now();
    setTokens({
      accessToken: tokens.access_token,
      accessTokenExpiresAt: now + tokens.expires_in * 1000,
      refreshToken: tokens.refresh_token,
      refreshTokenExpiresAt: now + tokens.refresh_expires_in * 1000,
      user: tokens.user,
    });

    exchangeSpinner.stop(true);
    console.log();
    success(`Successfully logged in as ${tokens.user.name || 'user'}!`);

    process.removeListener('SIGINT', cleanup);
  } catch (err) {
    process.removeListener('SIGINT', cleanup);

    if (cancelled) return;

    waitSpinner.stop(false);
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message === 'access_denied') {
      console.log();
      error('Authorization denied.');
      process.exit(1);
    }

    if (message === 'Authorization timed out') {
      console.log();
      error('Authorization timed out. Please try again.');
      process.exit(1);
    }

    console.log();
    error(`Authorization failed: ${message}`);
    process.exit(1);
  }
}
