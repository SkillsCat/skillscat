import { getCached } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { getAccessibleSkillIds } from '$lib/server/auth/permissions';
import { normalizeSearchText } from '$lib/server/ranking/search-precompute';
import { buildPrefixRange, type PrefixRange } from '$lib/server/text/prefix-range';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const REGISTRY_SEARCH_CACHE_TTL_SECONDS = 15 * 60;
const REGISTRY_SEARCH_CACHE_VERSION = 'v2';
const MAX_SHARED_CACHE_OFFSET = 80;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 64;
const MAX_QUERY_TOKENS = 8;
const MIN_QUERY_TOKEN_LENGTH = 2;
const TOKEN_SPLIT_REGEX = /[^\p{L}\p{N}]+/u;

let hasSkillSearchTermsTable: boolean | null = null;

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

function normalizeRegistrySearchCacheLimit(limit: number): number {
  if (limit <= 10) return 10;
  if (limit <= 20) return 20;
  if (limit <= 50) return 50;
  return 100;
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

function normalizeSearchQuery(value: string): string {
  return normalizeSearchText(value).slice(0, MAX_QUERY_LENGTH);
}

function splitQueryTokens(query: string): string[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];

  const dedup = new Set<string>();
  for (const token of normalized.split(TOKEN_SPLIT_REGEX)) {
    const normalizedToken = normalizeSearchQuery(token);
    if (!normalizedToken || normalizedToken.length < MIN_QUERY_TOKEN_LENGTH) continue;
    dedup.add(normalizedToken);
    if (dedup.size >= MAX_QUERY_TOKENS) break;
  }

  return Array.from(dedup);
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

function buildLowerPrefixPredicate(columnSql: string, range: PrefixRange): string {
  const lowerExpr = `LOWER(${columnSql})`;
  if (range.end) {
    return `${lowerExpr} >= ? AND ${lowerExpr} < ? AND ${lowerExpr} LIKE ?`;
  }
  return `${lowerExpr} >= ? AND ${lowerExpr} LIKE ?`;
}

function buildLowerPrefixParams(range: PrefixRange): string[] {
  const likePattern = `${range.start}%`;
  if (range.end) {
    return [range.start, range.end, likePattern];
  }
  return [range.start, likePattern];
}

function buildPrefixRangePredicate(columnSql: string, range: PrefixRange): string {
  if (range.end) {
    return `${columnSql} >= ? AND ${columnSql} < ?`;
  }
  return `${columnSql} >= ?`;
}

function buildPrefixRangeParams(range: PrefixRange): string[] {
  if (range.end) {
    return [range.start, range.end];
  }
  return [range.start];
}

async function hasSearchTermsTable(db: D1Database): Promise<boolean> {
  if (hasSkillSearchTermsTable !== null) {
    return hasSkillSearchTermsTable;
  }

  try {
    const result = await db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = 'skill_search_terms'
      LIMIT 1
    `).first<{ 1: number }>();
    hasSkillSearchTermsTable = Boolean(result);
  } catch {
    hasSkillSearchTermsTable = false;
  }

  return hasSkillSearchTermsTable;
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
  const cacheLimit = normalizeRegistrySearchCacheLimit(input.limit);
  const canUseSharedCache = canCache && input.offset <= MAX_SHARED_CACHE_OFFSET;

  if (canUseSharedCache) {
    const cacheKey = `search:${REGISTRY_SEARCH_CACHE_VERSION}:${input.query}:${input.category}:${cacheLimit}:${input.offset}`;
    const cached = await getCached(
      cacheKey,
      async () => fetchSearchResults(db, { ...input, limit: cacheLimit }, []),
      REGISTRY_SEARCH_CACHE_TTL_SECONDS,
      { waitUntil }
    );
    const skills = cached.data.skills.slice(0, input.limit);

    return {
      data: {
        ...cached.data,
        skills,
      },
      cacheControl: `public, max-age=${REGISTRY_SEARCH_CACHE_TTL_SECONDS}, stale-while-revalidate=3600`,
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
  const queryLimit = input.offset === 0 ? input.limit + 1 : input.limit;
  const normalizedQuery = normalizeSearchQuery(input.query);
  const queryTokens = splitQueryTokens(normalizedQuery);
  const searchTermsEnabled = normalizedQuery
    ? await hasSearchTermsTable(db)
    : false;

  if (normalizedQuery && searchTermsEnabled) {
    const prefixRange = buildPrefixRange(normalizedQuery);
    const prefixParams = buildLowerPrefixParams(prefixRange);
    const tokenPlaceholders = queryTokens.map(() => '?').join(',');
    const tokenRanges = queryTokens.map((token) => buildPrefixRange(token));
    const rawCandidateBranches: string[] = [];
    const rawCandidateParams: string[] = [];

    for (const [columnName, indexName] of [
      ['name', 'skills_visibility_lower_name_idx'],
      ['slug', 'skills_visibility_lower_slug_idx'],
      ['repo_owner', 'skills_visibility_lower_repo_owner_idx'],
      ['repo_name', 'skills_visibility_lower_repo_name_idx'],
    ] as const) {
      rawCandidateBranches.push(`
        SELECT s.id as skill_id
        FROM skills s INDEXED BY ${indexName}
        WHERE ${visibilityFilter.sql}
          AND ${buildLowerPrefixPredicate(`s.${columnName}`, prefixRange)}
      `);
      rawCandidateParams.push(...visibilityFilter.params, ...prefixParams);
    }

    if (queryTokens.length > 0) {
      rawCandidateBranches.push(`
        SELECT st.skill_id
        FROM skill_search_terms st INDEXED BY skill_search_terms_term_idx
        WHERE st.term IN (${tokenPlaceholders})
      `);
      rawCandidateParams.push(...queryTokens);

      for (const range of tokenRanges) {
        rawCandidateBranches.push(`
          SELECT st.skill_id
          FROM skill_search_terms st INDEXED BY skill_search_terms_term_idx
          WHERE ${buildPrefixRangePredicate('st.term', range)}
        `);
        rawCandidateParams.push(...buildPrefixRangeParams(range));
      }
    }

    const rawCandidatesSql = rawCandidateBranches.join('\n      UNION ALL\n');
    const categoryJoinSql = input.category
      ? `
        INNER JOIN skill_categories sc INDEXED BY skill_categories_category_skill_idx
          ON sc.skill_id = s.id
         AND sc.category_slug = ?
      `
      : '';
    const categoryParams = input.category ? [input.category] : [];

    const pageIdsResult = await db.prepare(`
      WITH raw_candidates AS (
        ${rawCandidatesSql}
      ),
      candidate_ids AS (
        SELECT skill_id
        FROM raw_candidates
        GROUP BY skill_id
      )
      SELECT s.id
      FROM candidate_ids c
      INNER JOIN skills s ON s.id = c.skill_id
      ${categoryJoinSql}
      WHERE ${visibilityFilter.sql}
      ORDER BY s.trending_score DESC
      LIMIT ? OFFSET ?
    `)
      .bind(...rawCandidateParams, ...categoryParams, ...visibilityFilter.params, queryLimit, input.offset)
      .all<{ id: string }>();

    const rawPageIds = (pageIdsResult.results || []).map((row) => row.id);
    const hasMoreOnFirstPage = input.offset === 0 && rawPageIds.length > input.limit;
    const pageIds = hasMoreOnFirstPage ? rawPageIds.slice(0, input.limit) : rawPageIds;

    let total: number;
    if (input.offset === 0 && !hasMoreOnFirstPage) {
      total = pageIds.length;
    } else {
      const countResult = await db.prepare(`
        WITH raw_candidates AS (
          ${rawCandidatesSql}
        ),
        candidate_ids AS (
          SELECT skill_id
          FROM raw_candidates
          GROUP BY skill_id
        )
        SELECT COUNT(*) as total
        FROM candidate_ids c
        INNER JOIN skills s ON s.id = c.skill_id
        ${categoryJoinSql}
        WHERE ${visibilityFilter.sql}
      `)
        .bind(...rawCandidateParams, ...categoryParams, ...visibilityFilter.params)
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

  const queryLike = `%${input.query}%`;
  const queryFilterSql = input.query ? 'AND (s.name LIKE ? OR s.description LIKE ?)' : '';
  const queryFilterParams: string[] = input.query ? [queryLike, queryLike] : [];

  const pageIdsResult = input.category
    ? await db.prepare(`
      SELECT s.id
      FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
      JOIN skills s ON s.id = sc.skill_id
      WHERE sc.category_slug = ?
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
        FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
        JOIN skills s ON s.id = sc.skill_id
        WHERE sc.category_slug = ?
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
