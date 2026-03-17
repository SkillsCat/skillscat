import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePage(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_PAGE), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE;
  return parsed;
}

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export const GET: RequestHandler = async ({ locals, platform, request, url }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId || !auth.user) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'read');

  const limit = parseLimit(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'));
  const page = parsePage(url.searchParams.get('page'));
  const offset = (page - 1) * limit;
  const queryLimit = offset === 0 ? limit + 1 : limit;

  const results = await db.prepare(`
    SELECT id, name, slug, description, visibility, stars, COALESCE(last_commit_at, updated_at) as updated_at
    FROM skills
    WHERE owner_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `)
    .bind(auth.userId, queryLimit, offset)
    .all<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      visibility: string;
      stars: number;
      updated_at: number;
    }>();

  const hasMoreOnFirstPage = offset === 0 && results.results.length > limit;
  const pageRows = hasMoreOnFirstPage ? results.results.slice(0, limit) : results.results;

  let total = 0;
  if (offset === 0 && !hasMoreOnFirstPage) {
    total = pageRows.length;
  } else {
    const countResult = await db.prepare(`SELECT COUNT(*) as count FROM skills WHERE owner_id = ?`)
      .bind(auth.userId)
      .first<{ count: number }>();
    total = countResult?.count ?? 0;
  }

  const totalPages = Math.ceil(total / limit);

  return json({
    skills: pageRows.map(s => ({
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
