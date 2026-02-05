import { homedir, hostname, platform, release } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { getResolvedRegistryUrl } from '../config/paths';
import { getConfigDir, getAuthPath, ensureConfigDir as ensureNewConfigDir } from '../config/config';

const CONFIG_FILE = getAuthPath();

export interface AuthConfig {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
  user?: {
    id: string;
    name?: string;
    email?: string;
    image?: string;
  };
  // Legacy field for backwards compatibility
  token?: string;
}

function ensureConfigDir(): void {
  ensureNewConfigDir();
}

export function loadConfig(): AuthConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content) as AuthConfig;
    }
  } catch {
    // Ignore errors, return empty config
  }
  return {};
}

export function saveConfig(config: AuthConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function clearConfig(): void {
  try {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Get the base URL for the API (derived from registry URL)
 */
export function getBaseUrl(): string {
  const registryUrl = getResolvedRegistryUrl();
  // Remove /registry suffix to get base URL
  return registryUrl.replace(/\/registry$/, '');
}

/**
 * Get client info for device authorization
 */
export function getClientInfo(): { os: string; hostname: string; version: string } {
  return {
    os: `${platform()} ${release()}`,
    hostname: hostname(),
    version: '0.1.0',
  };
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
} | null> {
  try {
    const response = await fetch(`${getBaseUrl()}/api/device/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      refresh_expires_in?: number;
    };

    const now = Date.now();
    const result: {
      accessToken: string;
      accessTokenExpiresAt: number;
      refreshToken?: string;
      refreshTokenExpiresAt?: number;
    } = {
      accessToken: data.access_token,
      accessTokenExpiresAt: now + data.expires_in * 1000,
    };

    if (data.refresh_token) {
      result.refreshToken = data.refresh_token;
      result.refreshTokenExpiresAt = now + (data.refresh_expires_in ?? 7776000) * 1000;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidToken(): Promise<string | null> {
  const config = loadConfig();

  // Check for legacy token field
  if (config.token && !config.accessToken) {
    return config.token;
  }

  if (!config.accessToken) {
    return null;
  }

  // Check if access token is still valid (with 5 minute buffer)
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000;

  if (config.accessTokenExpiresAt && config.accessTokenExpiresAt - now > bufferMs) {
    return config.accessToken;
  }

  // Token expired or expiring soon, try to refresh
  if (config.refreshToken) {
    // Check if refresh token is still valid
    if (config.refreshTokenExpiresAt && config.refreshTokenExpiresAt < now) {
      return null; // Refresh token expired, need to re-login
    }

    const newTokens = await refreshAccessToken(config.refreshToken);
    if (newTokens) {
      // Update config with new tokens
      const updatedConfig: AuthConfig = {
        ...config,
        accessToken: newTokens.accessToken,
        accessTokenExpiresAt: newTokens.accessTokenExpiresAt,
      };

      if (newTokens.refreshToken) {
        updatedConfig.refreshToken = newTokens.refreshToken;
        updatedConfig.refreshTokenExpiresAt = newTokens.refreshTokenExpiresAt;
      }

      saveConfig(updatedConfig);
      return newTokens.accessToken;
    }
  }

  return null; // Could not refresh, need to re-login
}

/**
 * Get the current token (without auto-refresh)
 * @deprecated Use getValidToken() instead for automatic refresh
 */
export function getToken(): string | undefined {
  const config = loadConfig();
  return config.accessToken ?? config.token;
}

/**
 * Set token directly (for --token flag)
 */
export function setToken(token: string, user?: AuthConfig['user']): void {
  const config = loadConfig();
  config.accessToken = token;
  config.token = token; // Keep legacy field for compatibility
  if (user) {
    config.user = user;
  }
  saveConfig(config);
}

/**
 * Set tokens from device authorization flow
 */
export function setTokens(tokens: {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  user: AuthConfig['user'];
}): void {
  const config: AuthConfig = {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    user: tokens.user,
  };
  saveConfig(config);
}

export function isAuthenticated(): boolean {
  const config = loadConfig();
  return !!(config.accessToken || config.token);
}

export function getUser(): AuthConfig['user'] | undefined {
  const config = loadConfig();
  return config.user;
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateRandomState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a PKCE code verifier (43-128 chars, cryptographically random)
 * Using 64 bytes = 86 chars base64url (within 43-128 range)
 */
export function generateCodeVerifier(): string {
  return randomBytes(64).toString('base64url');
}

/**
 * Compute PKCE code challenge from verifier using SHA-256
 * Returns base64url encoded hash (no padding)
 */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Initialize a CLI auth session
 */
export async function initAuthSession(
  baseUrl: string,
  callbackUrl: string,
  state: string,
  clientInfo?: { os: string; hostname: string; version: string },
  pkce?: { codeChallenge: string; codeChallengeMethod: 'S256' | 'plain' }
): Promise<{ session_id: string; expires_in: number }> {
  const url = `${baseUrl}/auth/init`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_url: callbackUrl,
        state,
        client_info: clientInfo,
        code_challenge: pkce?.codeChallenge,
        code_challenge_method: pkce?.codeChallengeMethod,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Connection failed to ${url}: ${message}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unable to read response');
    throw new Error(`HTTP ${response.status} from ${url}: ${errorText}`);
  }

  return response.json() as Promise<{ session_id: string; expires_in: number }>;
}

/**
 * Exchange auth code for tokens
 */
export async function exchangeCodeForTokens(
  baseUrl: string,
  code: string,
  sessionId: string,
  codeVerifier?: string
): Promise<{
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
}> {
  const response = await fetch(`${baseUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      session_id: sessionId,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const data = await response.json() as { error?: string };
    throw new Error(data.error || 'Failed to exchange code for tokens');
  }

  return response.json() as Promise<{
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
  }>;
}
