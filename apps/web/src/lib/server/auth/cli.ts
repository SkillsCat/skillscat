/**
 * CLI OAuth-style Authentication Flow Module
 *
 * Implements OAuth-style callback flow for CLI authentication
 * where CLI starts a local server and receives tokens via browser redirect.
 */

import type { D1Database } from '@cloudflare/workers-types';

const CLI_AUTH_SESSION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface ClientInfo {
  os?: string;
  hostname?: string;
  version?: string;
}

export interface PKCEParams {
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
}

export interface CliAuthSessionResponse {
  session_id: string;
  expires_in: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
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

/**
 * Generate a cryptographically secure random string
 */
function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash a token using SHA-256
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate an access token with sk_ prefix
 */
function generateAccessToken(): string {
  return 'sk_' + generateRandomString(32);
}

/**
 * Generate a refresh token with srt_ prefix
 */
function generateRefreshToken(): string {
  return 'srt_' + generateRandomString(32);
}

/**
 * Generate an auth code for the callback
 */
function generateAuthCode(): string {
  return generateRandomString(32);
}

/**
 * Validate that callback URL is localhost only
 */
function isValidCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.pathname === '/callback'
    );
  } catch {
    return false;
  }
}

/**
 * Verify PKCE code challenge against code verifier
 * Supports S256 (SHA-256) and plain methods
 */
async function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string
): Promise<boolean> {
  if (method === 'plain') {
    return verifier === challenge;
  }

  if (method === 'S256') {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    // Convert to base64url (no padding)
    const hashArray = new Uint8Array(hashBuffer);
    const base64 = btoa(String.fromCharCode(...hashArray));
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return base64url === challenge;
  }

  return false;
}

/**
 * Create a new CLI auth session
 */
export async function createCliAuthSession(
  db: D1Database,
  callbackUrl: string,
  state: string,
  clientInfo?: ClientInfo,
  pkce?: PKCEParams
): Promise<{ success: true; session: CliAuthSessionResponse } | { success: false; error: string }> {
  if (!isValidCallbackUrl(callbackUrl)) {
    return { success: false, error: 'Invalid callback URL. Must be localhost.' };
  }

  if (!state || state.length < 32) {
    return { success: false, error: 'Invalid state parameter.' };
  }

  // Validate PKCE parameters if provided
  if (pkce?.codeChallenge) {
    if (!pkce.codeChallengeMethod) {
      return { success: false, error: 'code_challenge_method is required when code_challenge is provided.' };
    }
    if (pkce.codeChallengeMethod !== 'S256' && pkce.codeChallengeMethod !== 'plain') {
      return { success: false, error: 'code_challenge_method must be S256 or plain.' };
    }
    // S256 challenge should be 43 chars (base64url of SHA-256)
    if (pkce.codeChallengeMethod === 'S256' && pkce.codeChallenge.length !== 43) {
      return { success: false, error: 'Invalid code_challenge length for S256.' };
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + CLI_AUTH_SESSION_EXPIRY_MS;

  await db.prepare(`
    INSERT INTO cli_auth_sessions (id, callback_url, state, client_info, code_challenge, code_challenge_method, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `)
    .bind(
      id,
      callbackUrl,
      state,
      clientInfo ? JSON.stringify(clientInfo) : null,
      pkce?.codeChallenge ?? null,
      pkce?.codeChallengeMethod ?? null,
      expiresAt,
      now
    )
    .run();

  return {
    success: true,
    session: {
      session_id: id,
      expires_in: Math.floor(CLI_AUTH_SESSION_EXPIRY_MS / 1000),
    },
  };
}

/**
 * Get CLI auth session by ID (for web authorization page)
 */
export async function getCliAuthSession(
  db: D1Database,
  sessionId: string
): Promise<{
  id: string;
  callbackUrl: string;
  state: string;
  status: string;
  clientInfo: ClientInfo | null;
  scopes: string[];
  expiresAt: number;
} | null> {
  const result = await db.prepare(`
    SELECT id, callback_url, state, status, client_info, scopes, expires_at
    FROM cli_auth_sessions
    WHERE id = ? AND expires_at > ?
  `)
    .bind(sessionId, Date.now())
    .first<{
      id: string;
      callback_url: string;
      state: string;
      status: string;
      client_info: string | null;
      scopes: string;
      expires_at: number;
    }>();

  if (!result) return null;

  return {
    id: result.id,
    callbackUrl: result.callback_url,
    state: result.state,
    status: result.status,
    clientInfo: result.client_info ? JSON.parse(result.client_info) : null,
    scopes: JSON.parse(result.scopes),
    expiresAt: result.expires_at,
  };
}

/**
 * Authorize a CLI auth session (called when user approves/denies in browser)
 * Returns the redirect URL with auth code and state
 */
export async function authorizeCliSession(
  db: D1Database,
  sessionId: string,
  userId: string,
  action: 'approve' | 'deny'
): Promise<{ success: true; redirectUrl: string } | { success: false; error: string }> {
  const now = Date.now();

  // Get session
  const session = await db.prepare(`
    SELECT id, callback_url, state, status, expires_at
    FROM cli_auth_sessions
    WHERE id = ?
  `)
    .bind(sessionId)
    .first<{
      id: string;
      callback_url: string;
      state: string;
      status: string;
      expires_at: number;
    }>();

  if (!session) {
    return { success: false, error: 'Invalid session' };
  }

  if (session.expires_at < now) {
    return { success: false, error: 'Session expired' };
  }

  if (session.status !== 'pending') {
    return { success: false, error: 'Session already processed' };
  }

  const callbackUrl = new URL(session.callback_url);

  if (action === 'deny') {
    await db.prepare(`
      UPDATE cli_auth_sessions SET status = 'denied' WHERE id = ?
    `)
      .bind(sessionId)
      .run();

    callbackUrl.searchParams.set('error', 'access_denied');
    callbackUrl.searchParams.set('state', session.state);
    return { success: true, redirectUrl: callbackUrl.toString() };
  }

  // Generate auth code
  const authCode = generateAuthCode();

  await db.prepare(`
    UPDATE cli_auth_sessions
    SET status = 'authorized', auth_code = ?, user_id = ?
    WHERE id = ?
  `)
    .bind(authCode, userId, sessionId)
    .run();

  callbackUrl.searchParams.set('code', authCode);
  callbackUrl.searchParams.set('state', session.state);

  return { success: true, redirectUrl: callbackUrl.toString() };
}

/**
 * Exchange auth code for tokens (called by CLI after receiving callback)
 */
export async function exchangeCliAuthCode(
  db: D1Database,
  code: string,
  sessionId: string,
  codeVerifier?: string
): Promise<{ success: true; tokens: TokenResponse } | { success: false; error: string }> {
  const now = Date.now();

  // Get session with user info and PKCE fields
  const result = await db.prepare(`
    SELECT s.id, s.auth_code, s.user_id, s.status, s.scopes, s.expires_at,
           s.code_challenge, s.code_challenge_method,
           u.name as user_name, u.email as user_email, u.image as user_image
    FROM cli_auth_sessions s
    LEFT JOIN user u ON s.user_id = u.id
    WHERE s.id = ?
  `)
    .bind(sessionId)
    .first<{
      id: string;
      auth_code: string | null;
      user_id: string | null;
      status: string;
      scopes: string;
      expires_at: number;
      code_challenge: string | null;
      code_challenge_method: string | null;
      user_name: string | null;
      user_email: string | null;
      user_image: string | null;
    }>();

  if (!result) {
    return { success: false, error: 'invalid_session' };
  }

  if (result.expires_at < now) {
    return { success: false, error: 'session_expired' };
  }

  if (result.status === 'used') {
    return { success: false, error: 'code_already_used' };
  }

  if (result.status !== 'authorized') {
    return { success: false, error: 'session_not_authorized' };
  }

  if (result.auth_code !== code) {
    return { success: false, error: 'invalid_code' };
  }

  if (!result.user_id) {
    return { success: false, error: 'no_user' };
  }

  // PKCE validation: if code_challenge was provided during init, code_verifier is required
  if (result.code_challenge && result.code_challenge_method) {
    if (!codeVerifier) {
      return { success: false, error: 'code_verifier_required' };
    }

    const isValid = await verifyCodeChallenge(
      codeVerifier,
      result.code_challenge,
      result.code_challenge_method
    );

    if (!isValid) {
      return { success: false, error: 'invalid_code_verifier' };
    }
  }

  // Generate tokens
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken();
  const accessTokenHash = await hashToken(accessToken);
  const refreshTokenHash = await hashToken(refreshToken);
  const accessTokenId = crypto.randomUUID();
  const refreshTokenId = crypto.randomUUID();
  const scopes = JSON.parse(result.scopes);

  // Create access token
  await db.prepare(`
    INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      accessTokenId,
      result.user_id,
      'CLI Auth',
      accessTokenHash,
      accessToken.slice(0, 11),
      JSON.stringify(scopes),
      now + ACCESS_TOKEN_EXPIRY_MS,
      now
    )
    .run();

  // Create refresh token
  await db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, token_prefix, access_token_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      refreshTokenId,
      result.user_id,
      refreshTokenHash,
      refreshToken.slice(0, 12),
      accessTokenId,
      now + REFRESH_TOKEN_EXPIRY_MS,
      now
    )
    .run();

  // Mark session as used
  await db.prepare(`
    UPDATE cli_auth_sessions SET status = 'used' WHERE id = ?
  `)
    .bind(sessionId)
    .run();

  return {
    success: true,
    tokens: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_EXPIRY_MS / 1000),
      refresh_token: refreshToken,
      refresh_expires_in: Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000),
      user: {
        id: result.user_id,
        name: result.user_name ?? undefined,
        email: result.user_email ?? undefined,
        image: result.user_image ?? undefined,
      },
    },
  };
}
