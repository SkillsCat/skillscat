import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { getAccessibleSkillIds } from '$lib/server/permissions';
import { getCached } from '$lib/server/cache';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 64;

function parseClampedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || String(fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function parseNonNegativeInt(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
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
  const limit = parseClampedInt(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 0);
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

function buildVisibilityFilter(
  accessiblePrivateIds: string[],
  tableAlias: string
): { sql: string; params: string[] } {
  if (accessiblePrivateIds.length === 0) {
    return {
      sql: `${tableAlias}.visibility = 'public'`,
      params: []
    };
  }

  const placeholders = accessiblePrivateIds.map(() => '?').join(',');
  return {
    sql: `(${tableAlias}.visibility = 'public' OR ${tableAlias}.id IN (${placeholders}))`,
    params: [...accessiblePrivateIds]
  };
}

async function fetchSearchResults(
  db: D1Database,
  query: string,
  category: string,
  limit: number,
  offset: number,
  accessiblePrivateIds: string[]
): Promise<RegistrySearchResult> {
  const visibilityFilter = buildVisibilityFilter(accessiblePrivateIds, 's');
  const queryLike = `%${query}%`;
  const queryFilterSql = query ? 'AND (s.name LIKE ? OR s.description LIKE ?)' : '';
  const queryFilterParams: string[] = query ? [queryLike, queryLike] : [];
  const queryLimit = offset === 0 ? limit + 1 : limit;

  const pageIdsResult = category
    ? await db.prepare(`
      SELECT s.id
      FROM skill_categories sc
      CROSS JOIN skills s
      WHERE s.id = sc.skill_id
        AND sc.category_slug = ?
        AND ${visibilityFilter.sql}
        ${queryFilterSql}
      ORDER BY s.trending_score DESC
      LIMIT ? OFFSET ?
    `)
      .bind(category, ...visibilityFilter.params, ...queryFilterParams, queryLimit, offset)
      .all<{ id: string }>()
    : await db.prepare(`
      SELECT s.id
      FROM skills s
      WHERE ${visibilityFilter.sql}
        ${queryFilterSql}
      ORDER BY s.trending_score DESC
      LIMIT ? OFFSET ?
    `)
      .bind(...visibilityFilter.params, ...queryFilterParams, queryLimit, offset)
      .all<{ id: string }>();

  const rawPageIds = (pageIdsResult.results || []).map((row) => row.id);
  const hasMoreOnFirstPage = offset === 0 && rawPageIds.length > limit;
  const pageIds = hasMoreOnFirstPage ? rawPageIds.slice(0, limit) : rawPageIds;

  // Fast-path: on first page, if returned rows are fewer than requested limit,
  // this page already contains all matches so no COUNT(*) scan is needed.
  let total: number;
  if (offset === 0 && !hasMoreOnFirstPage) {
    total = pageIds.length;
  } else {
    const countResult = category
      ? await db.prepare(`
        SELECT COUNT(*) as total
        FROM skill_categories sc
        CROSS JOIN skills s
        WHERE s.id = sc.skill_id
          AND sc.category_slug = ?
          AND ${visibilityFilter.sql}
          ${queryFilterSql}
      `)
        .bind(category, ...visibilityFilter.params, ...queryFilterParams)
        .first<{ total: number }>()
      : await db.prepare(`
        SELECT COUNT(*) as total
        FROM skills s
        WHERE ${visibilityFilter.sql}
          ${queryFilterSql}
      `)
        .bind(...visibilityFilter.params, ...queryFilterParams)
        .first<{ total: number }>();
    total = countResult?.total || 0;
  }

  if (pageIds.length === 0) {
    return { skills: [], total };
  }

  const idPlaceholders = pageIds.map(() => '?').join(',');

  const skillRows = await db.prepare(`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as owner,
      s.repo_name as repo,
      s.stars,
      COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
      s.visibility
    FROM skills s
    WHERE s.id IN (${idPlaceholders})
  `)
    .bind(...pageIds)
    .all<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    owner: string;
    repo: string;
    stars: number;
    updatedAt: number;
    visibility: string;
  }>();

  const categoryMap = new Map<string, string[]>();
  if (category) {
    for (const id of pageIds) {
      categoryMap.set(id, [category]);
    }
  } else {
    const categoriesResult = await db.prepare(`
      SELECT skill_id, category_slug
      FROM skill_categories
      WHERE skill_id IN (${idPlaceholders})
    `)
      .bind(...pageIds)
      .all<{ skill_id: string; category_slug: string }>();

    for (const row of categoriesResult.results || []) {
      const existing = categoryMap.get(row.skill_id);
      if (existing) {
        existing.push(row.category_slug);
        continue;
      }
      categoryMap.set(row.skill_id, [row.category_slug]);
    }
  }

  const skillMap = new Map(
    (skillRows.results || []).map((row) => [row.id, row] as const)
  );

  const skills: RegistrySkillItem[] = pageIds
    .map((id) => skillMap.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      name: row.name,
      description: row.description || '',
      owner: row.owner || '',
      repo: row.repo || '',
      stars: row.stars || 0,
      updatedAt: row.updatedAt,
      categories: categoryMap.get(row.id) || [],
      visibility: (row.visibility || 'public') as 'public' | 'private' | 'unlisted',
      slug: row.slug
    }));

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
