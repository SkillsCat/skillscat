import pc from 'picocolors';
import { setToken, setTokens, isAuthenticated, getUser, getBaseUrl, getClientInfo } from '../utils/auth.js';

interface LoginOptions {
  token?: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  user: {
    id: string;
    name?: string;
    email?: string;
    image?: string;
  };
}

export async function login(options: LoginOptions): Promise<void> {
  const baseUrl = getBaseUrl();

  // If token is provided directly, use it
  if (options.token) {
    try {
      const response = await fetch(`${baseUrl}/api/tokens`, {
        headers: {
          'Authorization': `Bearer ${options.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(pc.red('Invalid token. Please check your token and try again.'));
        process.exit(1);
      }

      setToken(options.token);
      console.log(pc.green('Successfully logged in with API token.'));
      return;
    } catch {
      console.error(pc.red('Failed to validate token. Please check your internet connection.'));
      process.exit(1);
    }
  }

  // Check if already authenticated
  if (isAuthenticated()) {
    const user = getUser();
    console.log(pc.yellow(`Already logged in${user?.name ? ` as ${user.name}` : ''}.`));
    console.log(pc.dim('Run `skillscat logout` to sign out first.'));
    return;
  }

  // Device Authorization Flow
  console.log(pc.cyan('Starting device authorization...'));
  console.log();

  // Step 1: Request device code
  let deviceCode: DeviceCodeResponse;
  try {
    const response = await fetch(`${baseUrl}/api/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_info: getClientInfo() }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    deviceCode = await response.json() as DeviceCodeResponse;
  } catch (error) {
    console.error(pc.red('Failed to start device authorization.'));
    console.error(pc.dim('Please check your internet connection and try again.'));
    process.exit(1);
  }

  // Step 2: Display instructions
  console.log(pc.bold('To complete authentication:'));
  console.log();
  console.log(`  1. Visit: ${pc.cyan(deviceCode.verification_uri)}`);
  console.log(`  2. Enter code: ${pc.bold(pc.yellow(deviceCode.user_code))}`);
  console.log();

  // Try to open browser
  const { exec } = await import('child_process');
  const platform = process.platform;
  const openCommand = platform === 'darwin' ? 'open' :
                      platform === 'win32' ? 'start' : 'xdg-open';

  const authUrl = `${deviceCode.verification_uri}?code=${encodeURIComponent(deviceCode.user_code)}`;

  exec(`${openCommand} "${authUrl}"`, (error) => {
    if (!error) {
      console.log(pc.dim('Browser opened automatically.'));
    }
  });

  console.log(pc.dim('Waiting for authorization...'));
  console.log(pc.dim('Press Ctrl+C to cancel.'));
  console.log();

  // Step 3: Poll for token
  const pollInterval = (deviceCode.interval || 5) * 1000;
  const expiresAt = Date.now() + deviceCode.expires_in * 1000;
  let lastStatus = '';

  // Handle Ctrl+C gracefully
  let cancelled = false;
  const cleanup = () => {
    cancelled = true;
    console.log();
    console.log(pc.yellow('Authorization cancelled.'));
    process.exit(0);
  };
  process.on('SIGINT', cleanup);

  while (!cancelled && Date.now() < expiresAt) {
    await sleep(pollInterval);

    if (cancelled) break;

    try {
      const response = await fetch(`${baseUrl}/api/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode.device_code }),
      });

      const data = await response.json() as TokenResponse | { error: string };

      if ('error' in data) {
        if (data.error === 'authorization_pending') {
          if (lastStatus !== 'pending') {
            lastStatus = 'pending';
          }
          // Show a spinner-like indicator
          process.stdout.write('.');
          continue;
        }

        if (data.error === 'slow_down') {
          // Server asked us to slow down
          await sleep(5000);
          continue;
        }

        if (data.error === 'expired_token') {
          console.log();
          console.error(pc.red('Authorization expired. Please try again.'));
          process.exit(1);
        }

        if (data.error === 'access_denied') {
          console.log();
          console.error(pc.red('Authorization denied.'));
          process.exit(1);
        }

        console.log();
        console.error(pc.red(`Authorization failed: ${data.error}`));
        process.exit(1);
      }

      // Success!
      console.log();
      console.log();

      const now = Date.now();
      setTokens({
        accessToken: data.access_token,
        accessTokenExpiresAt: now + data.expires_in * 1000,
        refreshToken: data.refresh_token,
        refreshTokenExpiresAt: now + data.refresh_expires_in * 1000,
        user: data.user,
      });

      console.log(pc.green('Successfully logged in!'));
      if (data.user.name) {
        console.log(pc.dim(`Welcome, ${data.user.name}!`));
      }

      process.removeListener('SIGINT', cleanup);
      return;
    } catch {
      // Network error, continue polling
      process.stdout.write('x');
    }
  }

  if (!cancelled) {
    console.log();
    console.error(pc.red('Authorization timed out. Please try again.'));
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
