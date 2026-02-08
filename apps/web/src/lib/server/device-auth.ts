/**
 * Device Authorization Flow Module
 *
 * Implements OAuth 2.0 Device Authorization Grant (RFC 8628)
 * for CLI authentication without browser-based redirect flows.
 */

import type { D1Database } from '@cloudflare/workers-types';

// Character set for user codes (excludes confusing chars: 0/O/1/I/L)
const USER_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEVICE_CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const POLL_INTERVAL_SECONDS = 5;

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
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

export interface ClientInfo {
  os?: string;
  hostname?: string;
  version?: string;
}

/**
 * Generate a cryptographically secure random string
 */
function generateRandomString(length: number, charset?: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  if (charset) {
    return Array.from(bytes)
      .map(b => charset[b % charset.length])
      .join('');
  }

  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a user-friendly code in XXXX-XXXX format
 */
function generateUserCode(): string {
  const part1 = generateRandomString(4, USER_CODE_CHARS);
  const part2 = generateRandomString(4, USER_CODE_CHARS);
  return `${part1}-${part2}`;
}

/**
 * Generate a 64-character device code
 */
function generateDeviceCode(): string {
  return generateRandomString(32); // 32 bytes = 64 hex chars
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
 * Create a new device code for CLI authentication
 */
export async function createDeviceCode(
  db: D1Database,
  baseUrl: string,
  clientInfo?: ClientInfo
): Promise<DeviceCodeResponse> {
  const id = crypto.randomUUID();
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const now = Date.now();
  const expiresAt = now + DEVICE_CODE_EXPIRY_MS;

  await db.prepare(`
    INSERT INTO device_codes (id, device_code, user_code, client_info, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `)
    .bind(
      id,
      deviceCode,
      userCode,
      clientInfo ? JSON.stringify(clientInfo) : null,
      expiresAt,
      now
    )
    .run();

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${baseUrl}/device`,
    expires_in: Math.floor(DEVICE_CODE_EXPIRY_MS / 1000),
    interval: POLL_INTERVAL_SECONDS,
  };
}

/**
 * Get device code info by user code (for web authorization page)
 */
export async function getDeviceCodeByUserCode(
  db: D1Database,
  userCode: string
): Promise<{
  id: string;
  status: string;
  clientInfo: ClientInfo | null;
  expiresAt: number;
  scopes: string[];
} | null> {
  const normalizedCode = userCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const formattedCode = normalizedCode.length === 8
    ? `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`
    : userCode.toUpperCase();

  const result = await db.prepare(`
    SELECT id, status, client_info, expires_at, scopes
    FROM device_codes
    WHERE user_code = ? AND expires_at > ?
  `)
    .bind(formattedCode, Date.now())
    .first<{
      id: string;
      status: string;
      client_info: string | null;
      expires_at: number;
      scopes: string;
    }>();

  if (!result) return null;

  return {
    id: result.id,
    status: result.status,
    clientInfo: result.client_info ? JSON.parse(result.client_info) : null,
    expiresAt: result.expires_at,
    scopes: JSON.parse(result.scopes),
  };
}

/**
 * Authorize a device code (called when user approves in browser)
 */
export async function authorizeDeviceCode(
  db: D1Database,
  userCode: string,
  userId: string,
  action: 'approve' | 'deny'
): Promise<{ success: boolean; error?: string }> {
  const normalizedCode = userCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const formattedCode = normalizedCode.length === 8
    ? `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`
    : userCode.toUpperCase();

  const now = Date.now();

  // Check if code exists and is pending
  const existing = await db.prepare(`
    SELECT id, status, expires_at FROM device_codes
    WHERE user_code = ?
  `)
    .bind(formattedCode)
    .first<{ id: string; status: string; expires_at: number }>();

  if (!existing) {
    return { success: false, error: 'Invalid code' };
  }

  if (existing.expires_at < now) {
    return { success: false, error: 'Code expired' };
  }

  if (existing.status !== 'pending') {
    return { success: false, error: 'Code already used' };
  }

  const newStatus = action === 'approve' ? 'authorized' : 'denied';

  await db.prepare(`
    UPDATE device_codes
    SET status = ?, user_id = ?, authorized_at = ?
    WHERE id = ?
  `)
    .bind(newStatus, action === 'approve' ? userId : null, now, existing.id)
    .run();

  return { success: true };
}

/**
 * Poll for token (called by CLI)
 * Returns token if authorized, error status otherwise
 */
export async function pollDeviceToken(
  db: D1Database,
  deviceCode: string
): Promise<
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'success'; tokens: TokenResponse }
> {
  const now = Date.now();

  const result = await db.prepare(`
    SELECT dc.id, dc.status, dc.user_id, dc.expires_at, dc.scopes,
           u.name as user_name, u.email as user_email, u.image as user_image
    FROM device_codes dc
    LEFT JOIN user u ON dc.user_id = u.id
    WHERE dc.device_code = ?
  `)
    .bind(deviceCode)
    .first<{
      id: string;
      status: string;
      user_id: string | null;
      expires_at: number;
      scopes: string;
      user_name: string | null;
      user_email: string | null;
      user_image: string | null;
    }>();

  if (!result) {
    return { status: 'expired' };
  }

  if (result.expires_at < now) {
    return { status: 'expired' };
  }

  if (result.status === 'pending') {
    return { status: 'pending' };
  }

  if (result.status === 'denied') {
    return { status: 'denied' };
  }

  if (result.status === 'used') {
    return { status: 'expired' };
  }

  if (result.status === 'authorized' && result.user_id) {
    // Atomically claim the code so concurrent polling cannot mint multiple token pairs.
    const claim = await db.prepare(`
      UPDATE device_codes
      SET status = 'used'
      WHERE id = ? AND status = 'authorized'
    `)
      .bind(result.id)
      .run();

    if ((claim.meta?.changes || 0) === 0) {
      return { status: 'expired' };
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
        'CLI Device Auth',
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

    return {
      status: 'success',
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

  return { status: 'expired' };
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
  db: D1Database,
  refreshToken: string
): Promise<{
  success: true;
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
} | {
  success: false;
  error: string;
}> {
  if (!refreshToken.startsWith('srt_')) {
    return { success: false, error: 'invalid_token' };
  }

  const tokenHash = await hashToken(refreshToken);
  const now = Date.now();

  const result = await db.prepare(`
    SELECT id, user_id, access_token_id, expires_at
    FROM refresh_tokens
    WHERE token_hash = ? AND revoked_at IS NULL
  `)
    .bind(tokenHash)
    .first<{
      id: string;
      user_id: string;
      access_token_id: string | null;
      expires_at: number;
    }>();

  if (!result) {
    return { success: false, error: 'invalid_token' };
  }

  if (result.expires_at < now) {
    return { success: false, error: 'token_expired' };
  }

  // Revoke old access token if exists
  if (result.access_token_id) {
    await db.prepare(`
      UPDATE api_tokens SET revoked_at = ? WHERE id = ?
    `)
      .bind(now, result.access_token_id)
      .run();
  }

  // Generate new access token
  const newAccessToken = generateAccessToken();
  const newAccessTokenHash = await hashToken(newAccessToken);
  const newAccessTokenId = crypto.randomUUID();

  // Get scopes from old token or use defaults
  const oldToken = result.access_token_id
    ? await db.prepare(`SELECT scopes FROM api_tokens WHERE id = ?`)
        .bind(result.access_token_id)
        .first<{ scopes: string }>()
    : null;
  const scopes = oldToken?.scopes ?? '["read","write","publish"]';

  await db.prepare(`
    INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      newAccessTokenId,
      result.user_id,
      'CLI Device Auth (Refreshed)',
      newAccessTokenHash,
      newAccessToken.slice(0, 11),
      scopes,
      now + ACCESS_TOKEN_EXPIRY_MS,
      now
    )
    .run();

  // Update refresh token to point to new access token
  await db.prepare(`
    UPDATE refresh_tokens SET access_token_id = ? WHERE id = ?
  `)
    .bind(newAccessTokenId, result.id)
    .run();

  const response: {
    success: true;
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_expires_in?: number;
  } = {
    success: true,
    access_token: newAccessToken,
    expires_in: Math.floor(ACCESS_TOKEN_EXPIRY_MS / 1000),
  };

  // If refresh token is expiring soon (< 7 days), issue a new one
  const refreshExpiresIn = result.expires_at - now;
  if (refreshExpiresIn < 7 * 24 * 60 * 60 * 1000) {
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = await hashToken(newRefreshToken);
    const newRefreshTokenId = crypto.randomUUID();

    // Revoke old refresh token
    await db.prepare(`
      UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?
    `)
      .bind(now, result.id)
      .run();

    // Create new refresh token
    await db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, token_prefix, access_token_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        newRefreshTokenId,
        result.user_id,
        newRefreshTokenHash,
        newRefreshToken.slice(0, 12),
        newAccessTokenId,
        now + REFRESH_TOKEN_EXPIRY_MS,
        now
      )
      .run();

    response.refresh_token = newRefreshToken;
    response.refresh_expires_in = Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000);
  }

  return response;
}
