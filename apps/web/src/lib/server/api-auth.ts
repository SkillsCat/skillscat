/**
 * API Token Authentication Module
 *
 * Handles creation, validation, and revocation of API tokens
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface TokenInfo {
  id: string;
  userId: string;
  name: string;
  scopes: string[];
  expiresAt: number | null;
}

/**
 * Generate a cryptographically secure random token
 */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'sk_' + Array.from(bytes)
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
 * Create a new API token for a user
 */
export async function createApiToken(
  userId: string,
  name: string,
  scopes: string[],
  db: D1Database,
  expiresInDays?: number
): Promise<{ token: string; tokenId: string }> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const tokenPrefix = token.slice(0, 11); // 'sk_' + first 8 chars
  const tokenId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;

  await db.prepare(`
    INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(tokenId, userId, name, tokenHash, tokenPrefix, JSON.stringify(scopes), expiresAt, now)
    .run();

  return { token, tokenId };
}

/**
 * Validate an API token and return token info if valid
 */
export async function validateApiToken(
  token: string,
  db: D1Database
): Promise<TokenInfo | null> {
  if (!token.startsWith('sk_')) {
    return null;
  }

  const tokenHash = await hashToken(token);
  const now = Date.now();

  const result = await db.prepare(`
    SELECT id, user_id, name, scopes, expires_at
    FROM api_tokens
    WHERE token_hash = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
  `)
    .bind(tokenHash, now)
    .first<{
      id: string;
      user_id: string;
      name: string;
      scopes: string;
      expires_at: number | null;
    }>();

  if (!result) {
    return null;
  }

  // Update last_used_at
  await db.prepare(`
    UPDATE api_tokens SET last_used_at = ? WHERE id = ?
  `)
    .bind(now, result.id)
    .run();

  return {
    id: result.id,
    userId: result.user_id,
    name: result.name,
    scopes: JSON.parse(result.scopes),
    expiresAt: result.expires_at,
  };
}

/**
 * Revoke an API token
 */
export async function revokeApiToken(
  tokenId: string,
  userId: string,
  db: D1Database
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE api_tokens
    SET revoked_at = ?
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `)
    .bind(Date.now(), tokenId, userId)
    .run();

  return result.meta.changes > 0;
}

/**
 * List all tokens for a user
 */
export async function listUserTokens(
  userId: string,
  db: D1Database
): Promise<Array<{
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
}>> {
  const results = await db.prepare(`
    SELECT id, name, token_prefix, scopes, last_used_at, expires_at, created_at
    FROM api_tokens
    WHERE user_id = ? AND org_id IS NULL AND revoked_at IS NULL
    ORDER BY created_at DESC
  `)
    .bind(userId)
    .all<{
      id: string;
      name: string;
      token_prefix: string;
      scopes: string;
      last_used_at: number | null;
      expires_at: number | null;
      created_at: number;
    }>();

  return results.results.map(row => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes),
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * Create a new API token for an organization
 */
export async function createOrgApiToken(
  orgId: string,
  name: string,
  scopes: string[],
  db: D1Database,
  expiresInDays?: number
): Promise<{ token: string; tokenId: string }> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const tokenPrefix = token.slice(0, 11); // 'sk_' + first 8 chars
  const tokenId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;

  await db.prepare(`
    INSERT INTO api_tokens (id, user_id, org_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(tokenId, orgId, name, tokenHash, tokenPrefix, JSON.stringify(scopes), expiresAt, now)
    .run();

  return { token, tokenId };
}

/**
 * List all tokens for an organization
 */
export async function listOrgTokens(
  orgId: string,
  db: D1Database
): Promise<Array<{
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
}>> {
  const results = await db.prepare(`
    SELECT id, name, token_prefix, scopes, last_used_at, expires_at, created_at
    FROM api_tokens
    WHERE org_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `)
    .bind(orgId)
    .all<{
      id: string;
      name: string;
      token_prefix: string;
      scopes: string;
      last_used_at: number | null;
      expires_at: number | null;
      created_at: number;
    }>();

  return results.results.map(row => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes),
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * Revoke an organization API token
 */
export async function revokeOrgApiToken(
  tokenId: string,
  orgId: string,
  db: D1Database
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE api_tokens
    SET revoked_at = ?
    WHERE id = ? AND org_id = ? AND revoked_at IS NULL
  `)
    .bind(Date.now(), tokenId, orgId)
    .run();

  return result.meta.changes > 0;
}
