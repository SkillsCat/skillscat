import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { getAccessibleSkillIds } from '$lib/server/permissions';
import { getCached } from '$lib/server/cache';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_OFFSET = 5000;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 64;

function parseClampedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || String(fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function normalizeQuery(value: string | null): string {
  return (value || '').trim().slice(0, MAX_QUERY_LENGTH);
}

function normalizeCategory(value: string | null): string {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized.length > MAX_CATEGORY_LENGTH) {
    return '';
  }
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return '';
  }
  return normalized;
}

export interface RegistrySkillItem {
  name: string;
  description: string;
  owner: string;
  repo: string;
  stars: number;
  updatedAt: number;
  categories: string[];
  visibility: 'public' | 'private' | 'unlisted';
  slug: string;
}

export interface RegistrySearchResult {
  skills: RegistrySkillItem[];
  total: number;
}

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const query = normalizeQuery(url.searchParams.get('q'));
  const category = normalizeCategory(url.searchParams.get('category'));
  const limit = parseClampedInt(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseClampedInt(url.searchParams.get('offset'), 0, 0, MAX_OFFSET);
  const includePrivate = url.searchParams.get('include_private') === 'true';

  const db = platform?.env?.DB;

  try {
    if (!db) {
      return json(
        { skills: [], total: 0 } satisfies RegistrySearchResult,
        { headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    let canIncludePrivate = false;
    let accessiblePrivateIds: string[] = [];

    if (includePrivate) {
      const auth = await getAuthContext(request, locals, db);
      if (auth.userId) {
        requireScope(auth, 'read');
        canIncludePrivate = true;
        accessiblePrivateIds = await getAccessibleSkillIds(auth.userId, db);
      }
    }

    // For public-only searches, use Cache API
    const canCache = !canIncludePrivate;
    let response: RegistrySearchResult;
    let hit = false;

    if (canCache) {
      const cacheKey = `search:${query}:${category}:${limit}:${offset}`;
      const cached = await getCached(
        cacheKey,
        async () => fetchSearchResults(db, query, category, limit, offset, []),
        30
      );
      response = cached.data;
      hit = cached.hit;
    } else {
      response = await fetchSearchResults(db, query, category, limit, offset, accessiblePrivateIds);
    }

    return json(response, {
      headers: {
        'Cache-Control': canCache ? 'public, max-age=30, stale-while-revalidate=90' : 'private, no-cache',
        'X-Cache': hit ? 'HIT' : 'MISS',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    console.error('Error searching skills:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistrySearchResult,
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
};

async function fetchSearchResults(
  db: D1Database,
  query: string,
  category: string,
  limit: number,
  offset: number,
  accessiblePrivateIds: string[]
): Promise<RegistrySearchResult> {
  // Build query
  let sql = `
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as owner,
      s.repo_name as repo,
      s.stars,
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
      s.visibility,
      GROUP_CONCAT(sc.category_slug) as categories
    FROM skills s
    LEFT JOIN skill_categories sc ON s.id = sc.skill_id
    WHERE (s.visibility = 'public'
  `;
  const params: (string | number)[] = [];

  // Include user's accessible private skills
  if (accessiblePrivateIds.length > 0) {
    const placeholders = accessiblePrivateIds.map(() => '?').join(',');
    sql += ` OR s.id IN (${placeholders})`;
    params.push(...accessiblePrivateIds);
  }

  sql += `)`;

  if (query) {
    sql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`);
  }

  if (category) {
    sql += ` AND sc.category_slug = ?`;
    params.push(category);
  }

  sql += ` GROUP BY s.id ORDER BY s.trending_score DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  // Execute query
  const result = await db.prepare(sql).bind(...params).all<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    owner: string;
    repo: string;
    stars: number;
    updatedAt: number;
    visibility: string;
    categories: string | null;
  }>();

  const skills: RegistrySkillItem[] = (result.results || []).map(row => ({
    name: row.name,
    description: row.description || '',
    owner: row.owner || '',
    repo: row.repo || '',
    stars: row.stars || 0,
    updatedAt: row.updatedAt,
    categories: row.categories ? row.categories.split(',') : [],
    visibility: (row.visibility || 'public') as 'public' | 'private' | 'unlisted',
    slug: row.slug
  }));

  // Get total count using the same visibility logic as the result query
  let countSql = `SELECT COUNT(DISTINCT s.id) as total FROM skills s`;
  const countParams: (string | number)[] = [];

  if (category) {
    countSql += ` LEFT JOIN skill_categories sc ON s.id = sc.skill_id`;
  }

  countSql += ` WHERE (s.visibility = 'public'`;
  if (accessiblePrivateIds.length > 0) {
    const placeholders = accessiblePrivateIds.map(() => '?').join(',');
    countSql += ` OR s.id IN (${placeholders})`;
    countParams.push(...accessiblePrivateIds);
  }
  countSql += `)`;

  if (query) {
    countSql += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
    countParams.push(`%${query}%`, `%${query}%`);
  }

  if (category) {
    countSql += ` AND sc.category_slug = ?`;
    countParams.push(category);
  }

  const countResult = await db.prepare(countSql).bind(...countParams).first<{ total: number }>();
  const total = countResult?.total || 0;

  return { skills, total };
}

// Handle CORS preflight
export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
      'Access-Control-Max-Age': '86400'
    }
  });
};
