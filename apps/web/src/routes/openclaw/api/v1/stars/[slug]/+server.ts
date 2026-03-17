import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { decodeClawHubCompatSlug } from '$lib/server/clawhub-compat';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/permissions';

interface SkillRow {
  id: string;
}

async function requireStarContext(
  request: Request,
  locals: App.Locals,
  db: D1Database,
  rawCompatSlug: string
): Promise<{ userId: string; skillId: string }> {
  const slug = decodeClawHubCompatSlug(rawCompatSlug);
  if (!slug) {
    throw error(400, 'Invalid compatibility slug.');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const skill = await db
    .prepare(`
      SELECT id
      FROM skills
      WHERE slug = ?
      LIMIT 1
    `)
    .bind(slug)
    .first<SkillRow>();

  if (!skill) {
    throw error(404, 'Skill not found.');
  }

  const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
  if (!hasAccess) {
    throw error(403, 'You do not have permission to access this skill.');
  }

  return { userId: auth.userId, skillId: skill.id };
}

export const POST: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(503, 'Database not available');
  }

  const { userId, skillId } = await requireStarContext(request, locals, db, params.slug);

  const existing = await db
    .prepare(`
      SELECT 1
      FROM favorites
      WHERE user_id = ? AND skill_id = ?
      LIMIT 1
    `)
    .bind(userId, skillId)
    .first();

  if (existing) {
    return json({ ok: true, starred: true, alreadyStarred: true });
  }

  await db
    .prepare(`
      INSERT INTO favorites (user_id, skill_id, created_at)
      VALUES (?, ?, ?)
    `)
    .bind(userId, skillId, Date.now())
    .run();

  await db
    .prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, ?, ?, 'favorite', ?)
    `)
    .bind(crypto.randomUUID(), userId, skillId, Date.now())
    .run();

  return json({ ok: true, starred: true, alreadyStarred: false });
};

export const DELETE: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(503, 'Database not available');
  }

  const { userId, skillId } = await requireStarContext(request, locals, db, params.slug);

  const existing = await db
    .prepare(`
      SELECT 1
      FROM favorites
      WHERE user_id = ? AND skill_id = ?
      LIMIT 1
    `)
    .bind(userId, skillId)
    .first();

  if (!existing) {
    return json({ ok: true, unstarred: true, alreadyUnstarred: true });
  }

  await db
    .prepare(`
      DELETE FROM favorites
      WHERE user_id = ? AND skill_id = ?
    `)
    .bind(userId, skillId)
    .run();

  await db
    .prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, ?, ?, 'unfavorite', ?)
    `)
    .bind(crypto.randomUUID(), userId, skillId, Date.now())
    .run();

  return json({ ok: true, unstarred: true, alreadyUnstarred: false });
};
