import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApiToken, listUserTokens } from '$lib/server/auth/api';

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

  const rawBody = await request.json() as unknown;
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw error(400, 'Invalid token request');
  }
  const body = rawBody as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const scopes = body.scopes === undefined ? ['read'] : body.scopes;
  const expiresInDays = body.expiresInDays;

  if (!name || name.length > 100) {
    throw error(400, 'Token name is required (1-100 characters)');
  }

  // Validate scopes
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
    throw error(400, 'scopes must be an array of strings');
  }
  const invalidScopes = scopes.filter(s => !VALID_SCOPES.includes(s));
  if (invalidScopes.length > 0) {
    throw error(400, `Invalid scopes: ${invalidScopes.join(', ')}`);
  }

  // Validate expiration
  if (
    expiresInDays !== undefined
    && (typeof expiresInDays !== 'number' || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)
  ) {
    throw error(400, 'Expiration must be between 1 and 365 days');
  }

  const { token, tokenId } = await createApiToken(
    session.user.id,
    name,
    scopes,
    db,
    expiresInDays as number | undefined
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
