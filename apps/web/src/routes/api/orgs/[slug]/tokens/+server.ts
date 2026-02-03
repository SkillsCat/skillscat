import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createOrgApiToken, listOrgTokens } from '$lib/server/api-auth';

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

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Get org and check permissions
  const membership = await db.prepare(`
    SELECT om.role, o.id as org_id FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string; org_id: string }>();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw error(403, 'Only organization owners and admins can view tokens');
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

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Get org and check permissions
  const membership = await db.prepare(`
    SELECT om.role, o.id as org_id FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string; org_id: string }>();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw error(403, 'Only organization owners and admins can create tokens');
  }

  const body = await request.json() as {
    name?: string;
    scopes?: string[];
    expiresInDays?: number;
  };

  const { name, scopes = ['read'], expiresInDays } = body;

  if (!name || name.trim().length === 0) {
    throw error(400, 'Token name is required');
  }

  if (name.length > 100) {
    throw error(400, 'Token name must be 100 characters or less');
  }

  const validScopes = ['read', 'write', 'publish'];
  for (const scope of scopes) {
    if (!validScopes.includes(scope)) {
      throw error(400, `Invalid scope: ${scope}`);
    }
  }

  const { token, tokenId } = await createOrgApiToken(
    membership.org_id,
    name.trim(),
    scopes,
    db,
    expiresInDays
  );

  return json({
    success: true,
    token,
    tokenId,
    message: 'Token created successfully. Save this token - it will not be shown again.',
  });
};