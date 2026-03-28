import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkSkillAccess } from '$lib/server/auth/permissions';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

export const GET: RequestHandler = async ({ locals, platform, url }) => {
  const skillId = url.searchParams.get('skillId')?.trim();
  if (!skillId) {
    throw error(400, 'skillId is required');
  }

  const session = await locals.auth?.();
  if (!session?.user) {
    return json({
      isAuthenticated: false,
      isBookmarked: false,
    }, {
      headers: NO_STORE_HEADERS,
    });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({
      isAuthenticated: true,
      isBookmarked: false,
    }, {
      headers: NO_STORE_HEADERS,
    });
  }

  const userId = session.user.id;
  const hasAccess = await checkSkillAccess(skillId, userId, db);
  if (!hasAccess) {
    throw error(404, 'Skill not found');
  }

  const bookmark = await db.prepare(`
    SELECT 1
    FROM favorites
    WHERE user_id = ? AND skill_id = ?
    LIMIT 1
  `)
    .bind(userId, skillId)
    .first();

  return json({
    isAuthenticated: true,
    isBookmarked: Boolean(bookmark),
  }, {
    headers: NO_STORE_HEADERS,
  });
};
