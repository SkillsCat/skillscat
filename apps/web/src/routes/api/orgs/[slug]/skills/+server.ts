import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, hasScope } from '$lib/server/auth/middleware';

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

/**
 * GET /api/orgs/[slug]/skills - List organization skills
 */
export const GET: RequestHandler = async ({ locals, platform, request, params, url }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  const limit = parseLimit(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'));
  const page = parsePage(url.searchParams.get('page'));
  const offset = (page - 1) * limit;
  const queryLimit = offset === 0 ? limit + 1 : limit;

  // Get org ID
  const org = await db.prepare(`
    SELECT id FROM organizations WHERE slug = ?
  `)
    .bind(slug)
    .first<{ id: string }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  // Get current user/token for permission check
  const auth = await getAuthContext(request, locals, db);
  const userId = auth.userId;
  const canUseReadScope = hasScope(auth, 'read');

  // Check if user is a member of the org
  let isMember = false;
  if (userId && canUseReadScope) {
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
  let countQuery: string;
  let bindings: (string | number)[];
  let countBindings: (string | number)[];

  if (isMember) {
    query = `
      SELECT id, name, slug, description, visibility, stars,
             CASE WHEN last_commit_at IS NULL THEN updated_at ELSE last_commit_at END AS updatedAt
      FROM skills INDEXED BY skills_org_stars_created_idx
      WHERE org_id = ?
      ORDER BY stars DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    bindings = [org.id, queryLimit, offset];
    countQuery = `SELECT COUNT(*) as count FROM skills INDEXED BY skills_org_stars_created_idx WHERE org_id = ?`;
    countBindings = [org.id];
  } else {
    query = `
      SELECT id, name, slug, description, visibility, stars,
             CASE WHEN last_commit_at IS NULL THEN updated_at ELSE last_commit_at END AS updatedAt
      FROM skills INDEXED BY skills_org_visibility_stars_created_idx
      WHERE org_id = ? AND visibility = 'public'
      ORDER BY stars DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    bindings = [org.id, queryLimit, offset];
    countQuery = `SELECT COUNT(*) as count FROM skills INDEXED BY skills_org_visibility_stars_created_idx WHERE org_id = ? AND visibility = 'public'`;
    countBindings = [org.id];
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
      updatedAt: number | null;
    }>();

  const hasMoreOnFirstPage = offset === 0 && results.results.length > limit;
  const pageRows = hasMoreOnFirstPage ? results.results.slice(0, limit) : results.results;

  let total = 0;
  if (offset === 0 && !hasMoreOnFirstPage) {
    total = pageRows.length;
  } else {
    const countResult = await db.prepare(countQuery)
      .bind(...countBindings)
      .first<{ count: number }>();
    total = countResult?.count ?? 0;
  }

  const totalPages = Math.ceil(total / limit);

  return json({
    success: true,
    skills: pageRows.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      visibility: s.visibility,
      stars: s.stars,
      updatedAt: s.updatedAt ?? undefined,
    })),
    total,
    page,
    totalPages,
  });
};
