import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '$lib/server/auth';
import { validateApiToken } from '$lib/server/auth/api';

interface TokenBackedUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean | number;
  image: string | null;
  createdAt: Date | number;
  updatedAt: Date | number;
}

/**
 * Resolve a Better Auth-compatible user from a Bearer token so SSR routes
 * can honor the same API tokens that the JSON endpoints accept.
 */
export async function resolveTokenBackedUser(
  request: Request,
  db: D1Database | undefined
): Promise<User | null> {
  if (!db) {
    return null;
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  const tokenInfo = await validateApiToken(token, db);
  if (!tokenInfo?.userId) {
    return null;
  }

  const row = await db.prepare(`
    SELECT
      id,
      name,
      email,
      email_verified as emailVerified,
      image,
      created_at as createdAt,
      updated_at as updatedAt
    FROM user
    WHERE id = ?
    LIMIT 1
  `)
    .bind(tokenInfo.userId)
    .first<TokenBackedUserRow>();

  if (!row) {
    return null;
  }

  return {
    ...row,
    emailVerified: Boolean(row.emailVerified),
  } as User;
}
