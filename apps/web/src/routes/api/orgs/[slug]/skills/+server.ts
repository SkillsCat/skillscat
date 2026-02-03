import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET /api/orgs/[slug]/skills - List organization skills
 */
export const GET: RequestHandler = async ({ locals, platform, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Get org ID
  const org = await db.prepare(`
    SELECT id FROM organizations WHERE slug = ?
  `)
    .bind(slug)
    .first<{ id: string }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  // Get current user for permission check
  const session = await locals.auth?.();
  const userId = session?.user?.id;

  // Check if user is a member of the org
  let isMember = false;
  if (userId) {
    const membership = await db.prepare(`
      SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?
    `)
      .bind(org.id, userId)
      .first();
    isMember = !!membership;
  }

  // Build query based on membership
  // Members can see all skills, non-members can only see public skills
  let query: string;
  let bindings: (string | number)[];

  if (isMember) {
    query = `
      SELECT id, name, slug, description, visibility, stars
      FROM skills
      WHERE org_id = ?
      ORDER BY stars DESC, created_at DESC
    `;
    bindings = [org.id];
  } else {
    query = `
      SELECT id, name, slug, description, visibility, stars
      FROM skills
      WHERE org_id = ? AND visibility = 'public'
      ORDER BY stars DESC, created_at DESC
    `;
    bindings = [org.id];
  }

  const results = await db.prepare(query)
    .bind(...bindings)
    .all<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      visibility: string;
      stars: number;
    }>();

  return json({
    success: true,
    skills: results.results.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      visibility: s.visibility,
      stars: s.stars,
    })),
  });
};
