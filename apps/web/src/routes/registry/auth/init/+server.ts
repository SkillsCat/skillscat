import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createCliAuthSession, type ClientInfo, type PKCEParams } from '$lib/server/cli-auth';

/**
 * POST /api/auth/cli/init - Initialize a CLI auth session
 *
 * Request body:
 * {
 *   callback_url: string,  // Must be localhost (e.g., http://localhost:9876/callback)
 *   state: string,         // CSRF protection token (min 32 chars)
 *   client_info?: { os?: string, hostname?: string, version?: string },
 *   code_challenge?: string,        // PKCE code challenge (base64url)
 *   code_challenge_method?: string  // 'S256' or 'plain'
 * }
 *
 * Response:
 * {
 *   session_id: string,    // Session ID for the auth page
 *   expires_in: number     // Seconds until expiration (300 = 5 min)
 * }
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  let body: {
    callback_url?: string;
    state?: string;
    client_info?: ClientInfo;
    code_challenge?: string;
    code_challenge_method?: 'S256' | 'plain';
  };

  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!body.callback_url) {
    throw error(400, 'callback_url is required');
  }

  if (!body.state) {
    throw error(400, 'state is required');
  }

  // Build PKCE params if provided
  const pkce: PKCEParams | undefined = body.code_challenge
    ? {
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
      }
    : undefined;

  try {
    const result = await createCliAuthSession(db, body.callback_url, body.state, body.client_info, pkce);

    if (!result.success) {
      throw error(400, result.error);
    }

    return json(result.session);
  } catch (e) {
    if (e instanceof Response) throw e;
    console.error('Failed to create CLI auth session:', e);
    throw error(500, 'Failed to create CLI auth session');
  }
};
