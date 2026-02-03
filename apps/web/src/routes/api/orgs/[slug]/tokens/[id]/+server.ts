import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { revokeOrgApiToken } from '$lib/server/api-auth';

/**
 * DELETE /api/orgs/[slug]/tokens/[id] - Revoke organization token
 */
export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { slug, id: tokenId } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }
  if (!tokenId) {
    throw error(400, 'Token ID is required');
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
    throw error(403, 'Only organization owners and admins can revoke tokens');
  }

  const revoked = await revokeOrgApiToken(tokenId, membership.org_id, db);

  if (!revoked) {
    throw error(404, 'Token not found or already revoked');
  }

  return json({
    success: true,
    message: 'Token revoked successfully',
  });
};
