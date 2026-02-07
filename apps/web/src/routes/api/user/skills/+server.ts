import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  const [results, countResult] = await Promise.all([
    db.prepare(`
      SELECT id, name, slug, description, visibility, stars, updated_at
      FROM skills
      WHERE owner_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
      .bind(session.user.id, limit, offset)
      .all<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        visibility: string;
        stars: number;
        updated_at: number;
      }>(),
    db.prepare(`SELECT COUNT(*) as count FROM skills WHERE owner_id = ?`)
      .bind(session.user.id)
      .first<{ count: number }>(),
  ]);

  const total = countResult?.count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return json({
    skills: results.results.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description ?? '',
      visibility: s.visibility as 'public' | 'private' | 'unlisted',
      stars: s.stars,
      updatedAt: s.updated_at,
    })),
    total,
    page,
    totalPages,
  });
};
