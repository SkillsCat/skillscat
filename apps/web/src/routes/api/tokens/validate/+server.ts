import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '$lib/server/middleware/auth';

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * GET /api/tokens/validate - Validate bearer API token
 */
export const GET: RequestHandler = async ({ locals, platform, request }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (auth.authMethod !== 'token' || !auth.userId) {
    throw error(401, 'Invalid or expired token');
  }

  const user = await db.prepare(`
    SELECT id, name, email, image
    FROM user
    WHERE id = ?
    LIMIT 1
  `)
    .bind(auth.userId)
    .first<UserRow>();

  if (!user) {
    throw error(401, 'Invalid token user');
  }

  return json({
    success: true,
    user: {
      id: user.id,
      name: user.name || undefined,
      email: user.email || undefined,
      image: user.image || undefined,
    },
  });
};
