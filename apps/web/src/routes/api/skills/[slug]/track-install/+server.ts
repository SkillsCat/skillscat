import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';

/**
 * POST /api/skills/[slug]/track-install - Track CLI installations
 */
export const POST: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;

  if (!db) {
    throw error(503, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Skill slug is required');
  }

  // Look up skill by slug
  const skill = await db.prepare('SELECT id, visibility FROM skills WHERE slug = ?')
    .bind(slug)
    .first<{ id: string; visibility: string }>();

  if (!skill) {
    throw error(404, 'Skill not found');
  }

  if (skill.visibility === 'private') {
    const auth = await getAuthContext(request, locals, db);
    if (!auth.userId) {
      throw error(404, 'Skill not found');
    }
    try {
      requireScope(auth, 'read');
    } catch {
      throw error(404, 'Skill not found');
    }

    const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
    if (!hasAccess) {
      throw error(404, 'Skill not found');
    }
  }

  // Track install in D1 to avoid KV write amplification.
  try {
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, NULL, ?, 'install', ?)
    `)
      .bind(crypto.randomUUID(), skill.id, Date.now())
      .run();
  } catch { /* non-critical */ }

  return json({ success: true });
};
