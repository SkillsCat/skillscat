import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { revokeApiToken } from '$lib/server/api-auth';

/**
 * DELETE /api/tokens/[id] - Revoke an API token
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

  const { id } = params;
  if (!id) {
    throw error(400, 'Token ID is required');
  }

  const revoked = await revokeApiToken(id, session.user.id, db);

  if (!revoked) {
    throw error(404, 'Token not found or already revoked');
  }

  return json({
    success: true,
    message: 'Token revoked successfully',
  });
};
