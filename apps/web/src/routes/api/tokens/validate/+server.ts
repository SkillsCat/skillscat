import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '$lib/server/auth/middleware';

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
  if (auth.authMethod !== 'token' || (!auth.userId && !auth.orgId)) {
    throw error(401, 'Invalid or expired token');
  }

  if (auth.orgId) {
    const org = await db.prepare(`
      SELECT id, slug, display_name, name, avatar_url
      FROM organizations
      WHERE id = ?
      LIMIT 1
    `)
      .bind(auth.orgId)
      .first<{
        id: string;
        slug: string;
        display_name: string | null;
        name: string;
        avatar_url: string | null;
      }>();

    if (!org) {
      throw error(401, 'Invalid token organization');
    }

    return json({
      success: true,
      principal: {
        type: 'org' as const,
        id: org.id,
        name: org.display_name || org.name,
        image: org.avatar_url || undefined,
        slug: org.slug,
      },
      organization: {
        id: org.id,
        slug: org.slug,
        name: org.display_name || org.name,
        image: org.avatar_url || undefined,
      },
    });
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
    principal: {
      type: 'user' as const,
      id: user.id,
      name: user.name || undefined,
      email: user.email || undefined,
      image: user.image || undefined,
    },
    user: {
      id: user.id,
      name: user.name || undefined,
      email: user.email || undefined,
      image: user.image || undefined,
    },
  });
};
