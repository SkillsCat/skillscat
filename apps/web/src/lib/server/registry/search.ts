import { getCached } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { getAccessibleSkillIds } from '$lib/server/permissions';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 64;

export interface RegistrySkillItem {
  name: string;
  description: string;
  owner: string;
  repo: string;
  stars: number;
  updatedAt: number;
  categories: string[];
  platform: 'github' | 'gitlab';
  visibility: 'public' | 'private' | 'unlisted';
  slug: string;
}

export interface RegistrySearchResult {
  skills: RegistrySkillItem[];
  total: number;
}

export interface RegistrySearchInput {
  query: string;
  category: string;
  limit: number;
  offset: number;
  includePrivate: boolean;
}

export interface ResolvedRegistrySearch {
  data: RegistrySearchResult;
  cacheControl: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
}

function parseClampedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function parseNonNegativeInt(raw: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeQuery(value: unknown): string {
  return String(value ?? '').trim().slice(0, MAX_QUERY_LENGTH);
}

function normalizeCategory(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase();
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

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function parseRegistrySearchInput(input: {
  q?: unknown;
  query?: unknown;
  category?: unknown;
  limit?: unknown;
  pageSize?: unknown;
  offset?: unknown;
  include_private?: unknown;
  includePrivate?: unknown;
}): RegistrySearchInput {
  return {
    query: normalizeQuery(input.q ?? input.query ?? ''),
    category: normalizeCategory(input.category ?? ''),
    limit: parseClampedInt(input.pageSize ?? input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: parseNonNegativeInt(input.offset, 0),
    includePrivate: parseBoolean(input.include_private ?? input.includePrivate),
  };
}

export function detectRegistrySkillPlatform(githubUrl: string | null | undefined): 'github' | 'gitlab' {
  const normalized = (githubUrl || '').toLowerCase();
  return normalized.includes('gitlab.com') ? 'gitlab' : 'github';
}

export async function resolveRegistrySearch(
  {
    db,
    request,
    locals,
    waitUntil,
  }: {
    db: D1Database | undefined;
    request: Request;
    locals: App.Locals;
    waitUntil?: (promise: Promise<unknown>) => void;
  },
  input: RegistrySearchInput
): Promise<ResolvedRegistrySearch> {
  if (!db) {
    return {
      data: { skills: [], total: 0 },
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
    };
  }

  let canIncludePrivate = false;
  let accessiblePrivateIds: string[] = [];

  if (input.includePrivate) {
    const auth = await getAuthContext(request, locals, db);
    if (auth.userId) {
      requireScope(auth, 'read');
      canIncludePrivate = true;
      accessiblePrivateIds = await getAccessibleSkillIds(auth.userId, db);
    }
  }

  const canCache = !canIncludePrivate;

  if (canCache) {
    const cacheKey = `search:${input.query}:${input.category}:${input.limit}:${input.offset}`;
    const cached = await getCached(
      cacheKey,
      async () => fetchSearchResults(db, input, []),
      30,
      { waitUntil }
    );

    return {
      data: cached.data,
      cacheControl: 'public, max-age=30, stale-while-revalidate=90',
      cacheStatus: cached.hit ? 'HIT' : 'MISS',
    };
  }

  return {
    data: await fetchSearchResults(db, input, accessiblePrivateIds),
    cacheControl: 'private, no-cache',
    cacheStatus: 'BYPASS',
  };
}

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
  input: RegistrySearchInput,
  accessiblePrivateIds: string[]
): Promise<RegistrySearchResult> {
  const visibilityFilter = buildVisibilityFilter(accessiblePrivateIds, 's');
  const queryLike = `%${input.query}%`;
  const queryFilterSql = input.query ? 'AND (s.name LIKE ? OR s.description LIKE ?)' : '';
  const queryFilterParams: string[] = input.query ? [queryLike, queryLike] : [];
  const queryLimit = input.offset === 0 ? input.limit + 1 : input.limit;

  const pageIdsResult = input.category
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
      .bind(input.category, ...visibilityFilter.params, ...queryFilterParams, queryLimit, input.offset)
      .all<{ id: string }>()
    : await db.prepare(`
      SELECT s.id
      FROM skills s
      WHERE ${visibilityFilter.sql}
        ${queryFilterSql}
      ORDER BY s.trending_score DESC
      LIMIT ? OFFSET ?
    `)
      .bind(...visibilityFilter.params, ...queryFilterParams, queryLimit, input.offset)
      .all<{ id: string }>();

  const rawPageIds = (pageIdsResult.results || []).map((row) => row.id);
  const hasMoreOnFirstPage = input.offset === 0 && rawPageIds.length > input.limit;
  const pageIds = hasMoreOnFirstPage ? rawPageIds.slice(0, input.limit) : rawPageIds;

  let total: number;
  if (input.offset === 0 && !hasMoreOnFirstPage) {
    total = pageIds.length;
  } else {
    const countResult = input.category
      ? await db.prepare(`
        SELECT COUNT(*) as total
        FROM skill_categories sc
        CROSS JOIN skills s
        WHERE s.id = sc.skill_id
          AND sc.category_slug = ?
          AND ${visibilityFilter.sql}
          ${queryFilterSql}
      `)
        .bind(input.category, ...visibilityFilter.params, ...queryFilterParams)
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
      s.github_url as githubUrl,
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
      githubUrl: string | null;
      stars: number;
      updatedAt: number;
      visibility: string;
    }>();

  const categoryMap = new Map<string, string[]>();
  if (input.category) {
    for (const id of pageIds) {
      categoryMap.set(id, [input.category]);
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
      platform: detectRegistrySkillPlatform(row.githubUrl),
      visibility: (row.visibility || 'public') as 'public' | 'private' | 'unlisted',
      slug: row.slug
    }));

  return { skills, total };
}
