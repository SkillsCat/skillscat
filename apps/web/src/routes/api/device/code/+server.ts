import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDeviceCode, type ClientInfo } from '$lib/server/device-auth';

/**
 * POST /api/device/code - Generate a new device code for CLI authentication
 *
 * Request body (optional):
 * {
 *   client_info?: { os?: string, hostname?: string, version?: string }
 * }
 *
 * Response:
 * {
 *   device_code: string,      // 64-char code for CLI polling
 *   user_code: string,        // "XXXX-XXXX" format for user to enter
 *   verification_uri: string, // URL to visit
 *   expires_in: number,       // Seconds until expiration (900 = 15 min)
 *   interval: number          // Polling interval in seconds (5)
 * }
 */
export const POST: RequestHandler = async ({ request, platform, url }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  let clientInfo: ClientInfo | undefined;

  try {
    const body = await request.json() as { client_info?: ClientInfo };
    clientInfo = body.client_info;
  } catch {
    // Body is optional, ignore parse errors
  }

  const baseUrl = `${url.protocol}//${url.host}`;

  try {
    const response = await createDeviceCode(db, baseUrl, clientInfo);
    return json(response);
  } catch (e) {
    console.error('Failed to create device code:', e);
    throw error(500, 'Failed to create device code');
  }
};
