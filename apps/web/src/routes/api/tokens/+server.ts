import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApiToken, listUserTokens } from '$lib/server/api-auth';

const VALID_SCOPES = ['read', 'write', 'publish'];

/**
 * POST /api/tokens - Create a new API token
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const body = await request.json() as {
    name?: string;
    scopes?: string[];
    expiresInDays?: number;
  };

  const { name, scopes = ['read'], expiresInDays } = body;

  if (!name || typeof name !== 'string' || name.length < 1 || name.length > 100) {
    throw error(400, 'Token name is required (1-100 characters)');
  }

  // Validate scopes
  const invalidScopes = scopes.filter(s => !VALID_SCOPES.includes(s));
  if (invalidScopes.length > 0) {
    throw error(400, `Invalid scopes: ${invalidScopes.join(', ')}`);
  }

  // Validate expiration
  if (expiresInDays !== undefined && (expiresInDays < 1 || expiresInDays > 365)) {
    throw error(400, 'Expiration must be between 1 and 365 days');
  }

  const { token, tokenId } = await createApiToken(
    session.user.id,
    name,
    scopes,
    db,
    expiresInDays
  );

  return json({
    success: true,
    token, // Only returned once at creation
    tokenId,
    message: 'Token created. Save it now - it will not be shown again.',
  });
};

/**
 * GET /api/tokens - List user's API tokens
 */
export const GET: RequestHandler = async ({ locals, platform }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const tokens = await listUserTokens(session.user.id, db);

  return json({
    success: true,
    tokens,
  });
};
