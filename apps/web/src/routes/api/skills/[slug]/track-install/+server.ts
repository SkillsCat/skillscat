import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/skills/[slug]/track-install - Track CLI installations
 */
export const POST: RequestHandler = async ({ params, platform }) => {
  const db = platform?.env?.DB;
  const kv = platform?.env?.KV;

  if (!db) {
    throw error(503, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Skill slug is required');
  }

  // Look up skill by slug
  const skill = await db.prepare('SELECT id FROM skills WHERE slug = ?')
    .bind(slug)
    .first<{ id: string }>();

  if (!skill) {
    throw error(404, 'Skill not found');
  }

  // Increment KV download counter (date-partitioned for true rolling window)
  if (kv) {
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const key = `dl:${skill.id}:${today}`;
      const current = parseInt(await kv.get(key) || '0');
      await kv.put(key, String(current + 1), { expirationTtl: 31 * 86400 });
    } catch { /* non-critical */ }
  }

  return json({ success: true });
};
