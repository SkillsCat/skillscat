import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pollDeviceToken } from '$lib/server/device-auth';

/**
 * POST /api/device/token - Poll for token after device authorization
 *
 * Request body:
 * {
 *   device_code: string
 * }
 *
 * Response (pending):
 * { error: "authorization_pending" }
 *
 * Response (expired):
 * { error: "expired_token" }
 *
 * Response (denied):
 * { error: "access_denied" }
 *
 * Response (success):
 * {
 *   access_token: string,
 *   token_type: "Bearer",
 *   expires_in: number,
 *   refresh_token: string,
 *   refresh_expires_in: number,
 *   user: { id, name, email, image }
 * }
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  let deviceCode: string;

  try {
    const body = await request.json() as { device_code?: string };
    if (!body.device_code || typeof body.device_code !== 'string') {
      throw error(400, 'device_code is required');
    }
    deviceCode = body.device_code;
  } catch (e) {
    if (e instanceof Error && 'status' in e) throw e;
    throw error(400, 'Invalid request body');
  }

  try {
    const result = await pollDeviceToken(db, deviceCode);

    switch (result.status) {
      case 'pending':
        return json({ error: 'authorization_pending' }, { status: 400 });

      case 'expired':
        return json({ error: 'expired_token' }, { status: 400 });

      case 'denied':
        return json({ error: 'access_denied' }, { status: 400 });

      case 'success':
        return json(result.tokens);
    }
  } catch (e) {
    console.error('Failed to poll device token:', e);
    throw error(500, 'Failed to poll device token');
  }
};
