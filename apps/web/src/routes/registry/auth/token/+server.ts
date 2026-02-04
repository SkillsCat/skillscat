import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCliAuthCode } from '$lib/server/cli-auth';

/**
 * POST /api/auth/cli/token - Exchange auth code for tokens
 *
 * Request body:
 * {
 *   code: string,           // Auth code from callback
 *   session_id: string,     // CLI auth session ID
 *   code_verifier?: string  // PKCE code verifier (required if code_challenge was provided during init)
 * }
 *
 * Response:
 * {
 *   access_token: string,
 *   token_type: 'Bearer',
 *   expires_in: number,
 *   refresh_token: string,
 *   refresh_expires_in: number,
 *   user: { id, name?, email?, image? }
 * }
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  let body: { code?: string; session_id?: string; code_verifier?: string };

  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!body.code) {
    throw error(400, 'code is required');
  }

  if (!body.session_id) {
    throw error(400, 'session_id is required');
  }

  try {
    const result = await exchangeCliAuthCode(db, body.code, body.session_id, body.code_verifier);

    if (!result.success) {
      return json({ error: result.error }, { status: 400 });
    }

    return json(result.tokens);
  } catch (e) {
    console.error('Failed to exchange CLI auth code:', e);
    throw error(500, 'Failed to exchange auth code');
  }
};
