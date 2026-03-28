import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordSkillAccess } from '$lib/server/db/utils';
import {
  getSkillAccessClientKey,
  shouldTrackSkillAccess,
} from '$lib/server/skill/access';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

export const POST: RequestHandler = async ({ locals, platform, request }) => {
  const body = await request.json() as { skillId?: string };
  const skillId = body.skillId?.trim();
  if (!skillId) {
    throw error(400, 'skillId is required');
  }

  if (!shouldTrackSkillAccess(request)) {
    return json({ success: true, skipped: true }, { headers: NO_STORE_HEADERS });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ success: true, skipped: true }, { headers: NO_STORE_HEADERS });
  }

  const skill = await db.prepare(`
    SELECT visibility
    FROM skills
    WHERE id = ?
    LIMIT 1
  `)
    .bind(skillId)
    .first<{ visibility: 'public' | 'private' | 'unlisted' | null }>();

  if (!skill || skill.visibility !== 'public') {
    return json({ success: true, skipped: true }, { headers: NO_STORE_HEADERS });
  }

  const session = await locals.auth?.();
  await recordSkillAccess(
    { DB: db },
    skillId,
    getSkillAccessClientKey(request, session?.user?.id ?? null)
  );

  return json({ success: true }, { headers: NO_STORE_HEADERS });
};
