import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshAccessToken } from '$lib/server/device-auth';

/**
 * POST /api/device/refresh - Refresh an access token
 *
 * Request body:
 * {
 *   refresh_token: string
 * }
 *
 * Response (success):
 * {
 *   access_token: string,
 *   expires_in: number,
 *   refresh_token?: string,      // Only if old refresh token is expiring soon
 *   refresh_expires_in?: number
 * }
 *
 * Response (error):
 * { error: "invalid_token" | "token_expired" }
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  let refreshToken: string;

  try {
    const body = await request.json() as { refresh_token?: string };
    if (!body.refresh_token || typeof body.refresh_token !== 'string') {
      throw error(400, 'refresh_token is required');
    }
    refreshToken = body.refresh_token;
  } catch (e) {
    if (e instanceof Error && 'status' in e) throw e;
    throw error(400, 'Invalid request body');
  }

  try {
    const result = await refreshAccessToken(db, refreshToken);

    if (!result.success) {
      return json({ error: result.error }, { status: 401 });
    }

    return json({
      access_token: result.access_token,
      expires_in: result.expires_in,
      ...(result.refresh_token && {
        refresh_token: result.refresh_token,
        refresh_expires_in: result.refresh_expires_in,
      }),
    });
  } catch (e) {
    console.error('Failed to refresh token:', e);
    throw error(500, 'Failed to refresh token');
  }
};
