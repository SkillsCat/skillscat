import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeCliSession } from '$lib/server/cli-auth';

/**
 * POST /api/auth/cli/authorize - Authorize or deny a CLI auth session
 *
 * Requires authenticated session.
 *
 * Request body:
 * {
 *   session_id: string,           // CLI auth session ID
 *   action: 'approve' | 'deny'    // User's decision
 * }
 *
 * Response:
 * {
 *   redirect_url: string          // Localhost callback URL with code/state or error
 * }
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const session = await locals.auth?.();
  if (!session?.user?.id) {
    throw error(401, 'Authentication required');
  }

  let body: { session_id?: string; action?: 'approve' | 'deny' };

  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!body.session_id) {
    throw error(400, 'session_id is required');
  }

  if (!body.action || !['approve', 'deny'].includes(body.action)) {
    throw error(400, 'action must be "approve" or "deny"');
  }

  try {
    const result = await authorizeCliSession(db, body.session_id, session.user.id, body.action);

    if (!result.success) {
      throw error(400, result.error);
    }

    return json({ redirect_url: result.redirectUrl });
  } catch (e) {
    if (e instanceof Response) throw e;
    console.error('Failed to authorize CLI session:', e);
    throw error(500, 'Failed to authorize CLI session');
  }
};
