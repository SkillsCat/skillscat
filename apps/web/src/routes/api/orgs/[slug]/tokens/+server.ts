import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createOrgApiToken, listOrgTokens } from '$lib/server/auth/api';

/**
 * GET /api/orgs/[slug]/tokens - List organization tokens
 */
export const GET: RequestHandler = async ({ locals, platform, params }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Get org and check permissions
  const membership = await db.prepare(`
    SELECT om.role, o.id as org_id FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string; org_id: string }>();

  if (membership?.role !== 'owner') {
    throw error(403, 'Only the organization owner can view tokens');
  }

  const tokens = await listOrgTokens(membership.org_id, db);

  return json({
    success: true,
    tokens,
  });
};

/**
 * POST /api/orgs/[slug]/tokens - Create organization token
 */
export const POST: RequestHandler = async ({ locals, platform, params, request }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Get org and check permissions
  const membership = await db.prepare(`
    SELECT om.role, o.id as org_id FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string; org_id: string }>();

  if (membership?.role !== 'owner') {
    throw error(403, 'Only the organization owner can create tokens');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw error(400, 'Invalid token request');
  }
  const body = rawBody as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const scopes = body.scopes === undefined ? ['read'] : body.scopes;
  const expiresInDays = body.expiresInDays;

  if (!name) {
    throw error(400, 'Token name is required');
  }

  if (name.length > 100) {
    throw error(400, 'Token name must be 100 characters or less');
  }

  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
    throw error(400, 'scopes must be an array of strings');
  }
  const validScopes = ['read', 'write', 'publish'];
  for (const scope of scopes) {
    if (!validScopes.includes(scope)) {
      throw error(400, `Invalid scope: ${scope}`);
    }
  }

  if (
    expiresInDays !== undefined
    && (typeof expiresInDays !== 'number' || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)
  ) {
    throw error(400, 'Expiration must be between 1 and 365 days');
  }

  const { token, tokenId } = await createOrgApiToken(
    membership.org_id,
    name,
    scopes,
    db,
    expiresInDays as number | undefined
  );

  return json({
    success: true,
    token,
    tokenId,
    message: 'Token created successfully. Save this token - it will not be shown again.',
  });
};
