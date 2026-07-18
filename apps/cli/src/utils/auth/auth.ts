import { hostname, platform, release } from 'node:os';
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { CLI_VERSION } from '../../version';
import {
  DEFAULT_REGISTRY_URL,
  getAuthPath,
  ensureConfigDir as ensureNewConfigDir,
  getRegistryOrigin,
  getRegistryUrl,
} from '../config/config';
import { fetchWithTimeout } from '../core/fetch';

const CONFIG_FILE = getAuthPath();

export interface AuthConfig {
  accessToken?: string;
  authOrigin?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
  user?: {
    id: string;
    name?: string;
    email?: string;
    image?: string;
  };
  principal?: AuthPrincipal;
}

export interface AuthPrincipal {
  type: 'user' | 'org';
  id: string;
  name?: string;
  email?: string;
  image?: string;
  slug?: string;
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
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      chmodSync(CONFIG_FILE, 0o600);
    } catch {
      // Best-effort permissions hardening.
    }
  }
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
  const registryUrl = getRegistryUrl();
  return registryUrl.replace(/\/(?:registry|openclaw)$/, '');
}

/**
 * Browser/device auth is implemented by the SkillsCat registry surface. The
 * OpenClaw compatibility registry shares the same origin and token, but does
 * not duplicate the /auth endpoints.
 */
export function getRegistryAuthUrl(): string {
  return getRegistryUrl().replace(/\/openclaw$/, '/registry');
}

function isAuthConfigForCurrentRegistry(config: AuthConfig): boolean {
  const currentOrigin = getRegistryOrigin();
  if (!currentOrigin) {
    return false;
  }

  if (config.authOrigin) {
    return config.authOrigin === currentOrigin;
  }

  // Legacy configs predate origin binding. Only trust them for the default
  // service; custom registries must authenticate again.
  return currentOrigin === getRegistryOrigin(DEFAULT_REGISTRY_URL);
}

/**
 * Get client info for device authorization
 */
export function getClientInfo(): { os: string; hostname: string; version: string } {
  return {
    os: `${platform()} ${release()}`,
    hostname: hostname(),
    version: CLI_VERSION,
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
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/device/refresh`, {
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

  if (!config.accessToken || !isAuthConfigForCurrentRegistry(config)) {
    return null;
  }

  // API tokens set via `login --token` may not have an expiry timestamp.
  if (!config.accessTokenExpiresAt) {
    return config.accessToken;
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
 * Validate an access token by calling token auth endpoint.
 */
export async function validateAccessToken(token: string): Promise<AuthPrincipal | null> {
  try {
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/tokens/validate`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      success?: boolean;
      principal?: AuthPrincipal;
      user?: AuthConfig['user'];
    };

    if (!data.success) {
      return null;
    }

    if (data.principal) {
      return data.principal;
    }

    return data.user
      ? { type: 'user', ...data.user }
      : null;
  } catch {
    return null;
  }
}

/**
 * Set token directly (for --token flag)
 */
export function setToken(token: string, principal?: AuthPrincipal): void {
  const config: AuthConfig = {
    accessToken: token,
    authOrigin: getRegistryOrigin() || undefined,
    principal,
    user: principal?.type === 'user'
      ? {
          id: principal.id,
          name: principal.name,
          email: principal.email,
          image: principal.image,
        }
      : undefined,
  };
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
    authOrigin: getRegistryOrigin() || undefined,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    user: tokens.user,
    principal: tokens.user
      ? { type: 'user', ...tokens.user }
      : undefined,
  };
  saveConfig(config);
}

export function isAuthenticated(): boolean {
  const config = loadConfig();
  return !!config.accessToken;
}

export function getUser(): AuthConfig['user'] | undefined {
  const config = loadConfig();
  return config.user;
}

export function getPrincipal(): AuthPrincipal | undefined {
  const config = loadConfig();
  if (config.principal) {
    return config.principal;
  }

  return config.user
    ? { type: 'user', ...config.user }
    : undefined;
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
    response = await fetchWithTimeout(url, {
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
  const response = await fetchWithTimeout(`${baseUrl}/auth/token`, {
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
