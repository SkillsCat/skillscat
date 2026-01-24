import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeDeviceCode } from '$lib/server/device-auth';

/**
 * POST /api/device/authorize - Authorize or deny a device code
 *
 * Requires session authentication.
 *
 * Request body:
 * {
 *   user_code: string,
 *   action: "approve" | "deny"
 * }
 *
 * Response:
 * { success: true }
 * or
 * { success: false, error: string }
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  let userCode: string;
  let action: 'approve' | 'deny';

  try {
    const body = await request.json() as {
      user_code?: string;
      action?: string;
    };

    if (!body.user_code || typeof body.user_code !== 'string') {
      throw error(400, 'user_code is required');
    }

    if (body.action !== 'approve' && body.action !== 'deny') {
      throw error(400, 'action must be "approve" or "deny"');
    }

    userCode = body.user_code;
    action = body.action;
  } catch (e) {
    if (e instanceof Error && 'status' in e) throw e;
    throw error(400, 'Invalid request body');
  }

  try {
    const result = await authorizeDeviceCode(db, userCode, session.user.id, action);

    if (!result.success) {
      return json({ success: false, error: result.error }, { status: 400 });
    }

    return json({ success: true });
  } catch (e) {
    console.error('Failed to authorize device code:', e);
    throw error(500, 'Failed to authorize device code');
  }
};
