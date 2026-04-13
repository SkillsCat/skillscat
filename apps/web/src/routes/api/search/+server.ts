import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES } from '$lib/constants';
import type { ApiResponse } from '$lib/types';
import { getCached } from '$lib/server/cache';
import {
  computeSearchScore,
  normalizeSearchText,
  SEARCH_SUGGESTION_MAX_PREFIX_LENGTH,
} from '$lib/server/ranking/search-precompute';
import { buildPrefixRange, type PrefixRange } from '$lib/server/text/prefix-range';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 64;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const SEARCH_CACHE_TTL_SECONDS = 15 * 60;
const SEARCH_CACHE_KEY_VERSION = 'v9';
const TERM_CANDIDATE_LIMIT_MULTIPLIER = 4;
const PREFIX_CANDIDATE_LIMIT_MULTIPLIER = 3;
const CATEGORY_CANDIDATE_LIMIT_MULTIPLIER = 2;
const MAX_CANDIDATE_LIMIT = 80;
const PREFIX_INDEX_MAX_ROWS_PER_TOKEN = 24;
const MAX_MATCHED_CATEGORIES = 4;
const MAX_QUERY_TOKENS = 8;
const MIN_QUERY_TOKEN_LENGTH = 2;
const MIN_TEXT_FUZZY_HEAD_SCAN = 96;
const MAX_TEXT_FUZZY_HEAD_SCAN = 320;
const TEXT_FUZZY_HEAD_SCAN_MULTIPLIER = 24;
const TOKEN_SPLIT_REGEX = /[^\p{L}\p{N}]+/u;

let hasSkillSearchStateTable: boolean | null = null;
let hasSkillSearchTermsTable: boolean | null = null;
let hasSkillSearchPrefixesTable: boolean | null = null;

interface SearchSuggestionSkill {
  id: string;
  name: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  stars: number;
  authorAvatar?: string;
}

type SearchSuggestionCategory = (typeof CATEGORIES)[number];

interface SearchSuggestionsResult {
  skills: SearchSuggestionSkill[];
  categories: SearchSuggestionCategory[];
  total: number;
}

interface MatchedCategory {
  slug: string;
  score: number;
}

interface SearchCandidateRow {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  repoOwner: string | null;
  repoName: string | null;
  stars: number | null;
  authorAvatar: string | null;
  precomputedScore: number | null;
  trendingScore: number | null;
  downloadCount30d: number | null;
  downloadCount90d: number | null;
  accessCount30d: number | null;
  lastCommitAt: number | null;
  updatedAt: number | null;
  tier: string | null;
  matchedCategoryCount?: number | null;
  matchedTermCount?: number | null;
  matchedTermWeight?: number | null;
}

interface RankedCandidate {
  row: SearchCandidateRow;
  queryRelevance: number;
  qualityScore: number;
  categoryBoost: number;
  termBoost: number;
  finalScore: number;
}

function parseLimit(rawLimit: string | null): number {
  const parsed = Number.parseInt(rawLimit || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function normalizeSearchCacheLimit(limit: number): number {
  if (limit <= 5) return 5;
  if (limit <= 10) return 10;
  return 20;
}

function normalizeCategory(value: string | null): string {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.length > MAX_CATEGORY_LENGTH) return '';
  if (!/^[a-z0-9-]+$/.test(normalized)) return '';
  return normalized;
}

function normalizeText(value: string | null | undefined): string {
  return normalizeSearchText(value);
}

function splitQueryTokens(query: string): string[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];

  const dedup = new Set<string>();
  for (const token of normalized.split(TOKEN_SPLIT_REGEX)) {
    const term = normalizeText(token);
    if (!term || term.length < MIN_QUERY_TOKEN_LENGTH) continue;
    dedup.add(term);
    if (dedup.size >= MAX_QUERY_TOKENS) break;
  }

  return Array.from(dedup);
}

function buildSuggestionPrefixTokens(queryTokens: string[]): string[] {
  const dedup = new Set<string>();

  for (const token of queryTokens) {
    const normalized = normalizeText(token);
    if (!normalized) continue;
    dedup.add(normalized.slice(0, SEARCH_SUGGESTION_MAX_PREFIX_LENGTH));
  }

  return Array.from(dedup);
}

function getCandidateLimit(limit: number, multiplier: number): number {
  return Math.min(MAX_CANDIDATE_LIMIT, Math.max(limit, Math.ceil(limit * multiplier)));
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

function buildExclusionClause(ids: string[], column: string): { sql: string; params: string[] } {
  const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
  if (normalizedIds.length === 0) {
    return { sql: '', params: [] };
  }

  return {
    sql: `AND ${column} NOT IN (${normalizedIds.map(() => '?').join(',')})`,
    params: normalizedIds
  };
}

function matchCategories(query: string): MatchedCategory[] {
  const result: MatchedCategory[] = [];

  for (const category of CATEGORIES) {
    const slug = normalizeText(category.slug);
    const name = normalizeText(category.name);
    const desc = normalizeText(category.description);

    let score = 0;
    if (slug === query) score = 140;
    else if (name === query) score = 130;
    else if (slug.startsWith(query)) score = 115;
    else if (name.startsWith(query)) score = 110;
    else if (slug.includes(query)) score = 90;
    else if (name.includes(query)) score = 88;
    else if (desc.includes(query)) score = 64;

    if (score === 0) {
      for (const keyword of category.keywords) {
        const normalizedKeyword = normalizeText(keyword);
        if (!normalizedKeyword) continue;
        if (normalizedKeyword === query) {
          score = Math.max(score, 104);
          break;
        }
        if (normalizedKeyword.startsWith(query)) {
          score = Math.max(score, 86);
          continue;
        }
        if (normalizedKeyword.includes(query)) {
          score = Math.max(score, 72);
        }
      }
    }

    if (score > 0) {
      result.push({ slug: category.slug, score });
    }
  }

  return result
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHED_CATEGORIES);
}

function computeQueryRelevance(row: SearchCandidateRow, query: string, queryTokens: string[]): number {
  const name = normalizeText(row.name);
  const slug = normalizeText(row.slug);
  const owner = normalizeText(row.repoOwner);
  const repo = normalizeText(row.repoName);
  const combinedRepo = `${owner}/${repo}`;

  let score = 0;

  if (name === query) score = Math.max(score, 130);
  else if (name.startsWith(query)) score = Math.max(score, 116);
  else if (name.includes(query)) score = Math.max(score, 84);

  if (slug === query) score = Math.max(score, 122);
  else if (slug.startsWith(query)) score = Math.max(score, 109);
  else if (slug.includes(query)) score = Math.max(score, 78);

  if (owner === query) score = Math.max(score, 106);
  else if (owner.startsWith(query)) score = Math.max(score, 92);
  else if (owner.includes(query)) score = Math.max(score, 70);

  if (repo === query || combinedRepo === query) score = Math.max(score, 102);
  else if (repo.startsWith(query) || combinedRepo.startsWith(query)) score = Math.max(score, 88);
  else if (repo.includes(query) || combinedRepo.includes(query)) score = Math.max(score, 68);

  if (queryTokens.length > 0) {
    let tokenScore = 0;
    for (const token of queryTokens) {
      if (name.includes(token)) tokenScore += 14;
      else if (slug.includes(token)) tokenScore += 11;
      else if (repo.includes(token) || owner.includes(token)) tokenScore += 8;
    }
    score += Math.min(56, tokenScore);
  }

  return score;
}

function getQualityScore(row: SearchCandidateRow): number {
  if (typeof row.precomputedScore === 'number' && Number.isFinite(row.precomputedScore)) {
    return Math.max(0, row.precomputedScore);
  }

  return computeSearchScore({
    stars: row.stars,
    trendingScore: row.trendingScore,
    downloadCount30d: row.downloadCount30d,
    downloadCount90d: row.downloadCount90d,
    accessCount30d: row.accessCount30d,
    lastCommitAt: row.lastCommitAt,
    updatedAt: row.updatedAt,
    tier: row.tier
  });
}

function toSuggestionSkill(row: SearchCandidateRow): SearchSuggestionSkill {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    repoOwner: row.repoOwner || '',
    repoName: row.repoName || '',
    stars: Number(row.stars || 0),
    authorAvatar: row.authorAvatar || undefined
  };
}

function matchesFuzzyTextCandidate(row: SearchCandidateRow, query: string): boolean {
  return (
    normalizeText(row.name).includes(query)
    || normalizeText(row.slug).includes(query)
    || normalizeText(row.description).includes(query)
    || normalizeText(row.repoOwner).includes(query)
    || normalizeText(row.repoName).includes(query)
  );
}

function rankCandidates(
  query: string,
  queryTokens: string[],
  textRows: SearchCandidateRow[],
  categoryRows: SearchCandidateRow[],
  limit: number
): SearchSuggestionSkill[] {
  const merged = new Map<string, RankedCandidate>();

  const upsert = (row: SearchCandidateRow, fromCategoryRecall: boolean) => {
    const qualityScore = getQualityScore(row);
    const queryRelevance = computeQueryRelevance(row, query, queryTokens);
    const matchedCategoryCount = Math.max(0, Number(row.matchedCategoryCount || 0));
    const categoryBoost = matchedCategoryCount > 0
      ? Math.min(48, 30 + (matchedCategoryCount - 1) * 8)
      : 0;

    const matchedTermCount = Math.max(0, Number(row.matchedTermCount || 0));
    const matchedTermWeight = Math.max(0, Number(row.matchedTermWeight || 0));
    const termBoost = Math.min(120, matchedTermCount * 20 + matchedTermWeight * 7);

    const sourceBoost = fromCategoryRecall ? 0 : 10;
    const finalScore = queryRelevance * 100 + qualityScore * 10 + categoryBoost + termBoost + sourceBoost;

    const existing = merged.get(row.id);
    if (!existing || finalScore > existing.finalScore) {
      merged.set(row.id, {
        row,
        queryRelevance,
        qualityScore,
        categoryBoost,
        termBoost,
        finalScore
      });
    }
  };

  for (const row of textRows) {
    upsert(row, false);
  }
  for (const row of categoryRows) {
    upsert(row, true);
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      if (b.queryRelevance !== a.queryRelevance) return b.queryRelevance - a.queryRelevance;
      if (b.termBoost !== a.termBoost) return b.termBoost - a.termBoost;
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return Number(b.row.stars || 0) - Number(a.row.stars || 0);
    })
    .slice(0, limit)
    .map((candidate) => toSuggestionSkill(candidate.row));
}

async function fetchTermCandidates(
  db: D1Database,
  queryTokens: string[],
  limit: number,
  useSearchState: boolean,
  category: string
): Promise<SearchCandidateRow[]> {
  if (queryTokens.length === 0) return [];

  const candidateLimit = getCandidateLimit(limit, TERM_CANDIDATE_LIMIT_MULTIPLIER);
  const exactLimit = Math.min(candidateLimit, Math.max(limit, Math.ceil(candidateLimit * 0.65)));

  const searchStateJoinSql = useSearchState ? 'LEFT JOIN skill_search_state ss ON ss.skill_id = s.id' : '';
  const searchScoreSelectSql = useSearchState ? 'ss.score as precomputedScore' : 'NULL as precomputedScore';
  const searchScoreOrderSql = useSearchState ? 'COALESCE(ss.score, 0) DESC,' : '';
  const categoryJoinSql = category
    ? `
      INNER JOIN skill_categories sc INDEXED BY skill_categories_category_skill_idx
        ON sc.skill_id = st.skill_id
       AND sc.category_slug = ?
    `
    : '';
  const categoryParams = category ? [category] : [];
  const tokenRanges = queryTokens.map((token) => buildPrefixRange(token));

  const tokenPlaceholders = queryTokens.map(() => '?').join(',');

  const exactRows = await db.prepare(`
    WITH matched_terms AS (
      SELECT
        st.skill_id as skillId,
        COUNT(*) as matchedTermCount,
        MAX(st.weight) as matchedTermWeight
      FROM skill_search_terms st
      ${categoryJoinSql}
      WHERE st.term IN (${tokenPlaceholders})
      GROUP BY st.skill_id
    )
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      a.avatar_url as authorAvatar,
      ${searchScoreSelectSql},
      s.trending_score as trendingScore,
      s.download_count_30d as downloadCount30d,
      s.download_count_90d as downloadCount90d,
      s.access_count_30d as accessCount30d,
      s.last_commit_at as lastCommitAt,
      s.updated_at as updatedAt,
      s.tier,
      matched.matchedTermCount as matchedTermCount,
      matched.matchedTermWeight as matchedTermWeight
    FROM matched_terms matched
    JOIN skills s ON s.id = matched.skillId
    LEFT JOIN authors a ON s.repo_owner = a.username
    ${searchStateJoinSql}
    WHERE s.visibility = 'public'
    ORDER BY
      matched.matchedTermCount DESC,
      matched.matchedTermWeight DESC,
      ${searchScoreOrderSql}
      s.trending_score DESC
    LIMIT ?
  `)
    .bind(...categoryParams, ...queryTokens, exactLimit)
    .all<SearchCandidateRow>();

  const merged = new Map<string, SearchCandidateRow>();
  for (const row of exactRows.results || []) {
    merged.set(row.id, row);
  }

  const remaining = Math.max(0, candidateLimit - merged.size);
  if (remaining <= 0) {
    return Array.from(merged.values());
  }

  const exclusion = buildExclusionClause(Array.from(merged.keys()), 's.id');
  const prefixUnionSql = tokenRanges
    .map((range) => `
      SELECT
        st.skill_id as skillId,
        st.weight as weight
      FROM skill_search_terms st INDEXED BY skill_search_terms_term_weight_idx
      ${categoryJoinSql}
      WHERE ${buildPrefixRangePredicate('st.term', range)}
    `)
    .join('\n      UNION ALL\n');
  const prefixParams = tokenRanges.flatMap((range) => [
    ...categoryParams,
    ...buildPrefixRangeParams(range),
  ]);

  const prefixRows = await db.prepare(`
    WITH term_prefix_matches AS (
      ${prefixUnionSql}
    ),
    matched_terms AS (
      SELECT
        skillId,
        COUNT(*) as matchedTermCount,
        MAX(weight) as matchedTermWeight
      FROM term_prefix_matches
      GROUP BY skillId
    )
    SELECT
      s.id,
      s.name,
      s.slug,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      a.avatar_url as authorAvatar,
      ${searchScoreSelectSql},
      s.trending_score as trendingScore,
      s.download_count_30d as downloadCount30d,
      s.download_count_90d as downloadCount90d,
      s.access_count_30d as accessCount30d,
      s.last_commit_at as lastCommitAt,
      s.updated_at as updatedAt,
      s.tier,
      matched.matchedTermCount as matchedTermCount,
      matched.matchedTermWeight as matchedTermWeight
    FROM matched_terms matched
    JOIN skills s ON s.id = matched.skillId
    LEFT JOIN authors a ON s.repo_owner = a.username
    ${searchStateJoinSql}
    WHERE s.visibility = 'public'
      ${exclusion.sql}
    ORDER BY
      matched.matchedTermCount DESC,
      matched.matchedTermWeight DESC,
      ${searchScoreOrderSql}
      s.trending_score DESC
    LIMIT ?
  `)
    .bind(...prefixParams, ...exclusion.params, remaining)
    .all<SearchCandidateRow>();

  for (const row of prefixRows.results || []) {
    if (!merged.has(row.id)) {
      merged.set(row.id, row);
    }
  }

  return Array.from(merged.values());
}

async function fetchPrefixCandidates(
  db: D1Database,
  prefixTokens: string[],
  limit: number,
  useSearchState: boolean,
  category: string
): Promise<SearchCandidateRow[]> {
  if (prefixTokens.length === 0) return [];

  const candidateLimit = getCandidateLimit(limit, TERM_CANDIDATE_LIMIT_MULTIPLIER);
  const perTokenLimit = Math.min(
    PREFIX_INDEX_MAX_ROWS_PER_TOKEN,
    Math.max(limit, Math.ceil(candidateLimit / Math.max(prefixTokens.length, 1)))
  );
  const searchStateJoinSql = useSearchState ? 'LEFT JOIN skill_search_state ss ON ss.skill_id = s.id' : '';
  const searchScoreSelectSql = useSearchState ? 'ss.score as precomputedScore' : 'NULL as precomputedScore';
  const searchScoreOrderSql = useSearchState ? 'COALESCE(ss.score, 0) DESC,' : '';
  const categoryJoinSql = category
    ? `
      INNER JOIN skill_categories sc INDEXED BY skill_categories_category_skill_idx
        ON sc.skill_id = sp.skill_id
       AND sc.category_slug = ?
    `
    : '';
  const categoryParams = category ? [category] : [];

  const perPrefixSql = prefixTokens
    .map(() => `
      SELECT skillId, weight FROM (
        SELECT
          sp.skill_id as skillId,
          sp.weight as weight
        FROM skill_search_prefixes sp INDEXED BY skill_search_prefixes_prefix_weight_skill_idx
        ${categoryJoinSql}
        WHERE sp.prefix = ?
        ORDER BY sp.weight DESC, sp.skill_id ASC
        LIMIT ?
      )
    `)
    .join('\n      UNION ALL\n');
  const perPrefixParams = prefixTokens.flatMap((prefix) => [
    ...categoryParams,
    prefix,
    perTokenLimit,
  ]);

  const rows = await db.prepare(`
    WITH matched_prefixes AS (
      SELECT
        skillId,
        COUNT(*) as matchedTermCount,
        MAX(weight) as matchedTermWeight,
        SUM(weight) as matchedPrefixTotalWeight
      FROM (
        ${perPrefixSql}
      )
      GROUP BY skillId
    )
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      a.avatar_url as authorAvatar,
      ${searchScoreSelectSql},
      s.trending_score as trendingScore,
      s.download_count_30d as downloadCount30d,
      s.download_count_90d as downloadCount90d,
      s.access_count_30d as accessCount30d,
      s.last_commit_at as lastCommitAt,
      s.updated_at as updatedAt,
      s.tier,
      matched.matchedTermCount as matchedTermCount,
      matched.matchedTermWeight as matchedTermWeight
    FROM matched_prefixes matched
    JOIN skills s ON s.id = matched.skillId
    LEFT JOIN authors a ON s.repo_owner = a.username
    ${searchStateJoinSql}
    WHERE s.visibility = 'public'
    ORDER BY
      matched.matchedTermCount DESC,
      matched.matchedPrefixTotalWeight DESC,
      matched.matchedTermWeight DESC,
      ${searchScoreOrderSql}
      s.trending_score DESC
    LIMIT ?
  `)
    .bind(...perPrefixParams, candidateLimit)
    .all<SearchCandidateRow>();

  return rows.results || [];
}

async function fetchTextCandidates(
  db: D1Database,
  query: string,
  limit: number,
  useSearchState: boolean,
  excludedIds: string[],
  category: string
): Promise<SearchCandidateRow[]> {
  const prefixRange = buildPrefixRange(query);

  const prefixLimit = getCandidateLimit(limit, PREFIX_CANDIDATE_LIMIT_MULTIPLIER);
  const fuzzyLimit = limit;
  const prefixPerColumnLimit = Math.max(limit, Math.ceil(prefixLimit / 2));

  const searchStateJoinSql = useSearchState ? 'LEFT JOIN skill_search_state ss ON ss.skill_id = s.id' : '';
  const searchScoreSelectSql = useSearchState ? 'ss.score as precomputedScore' : 'NULL as precomputedScore';
  const searchScoreOrderSql = useSearchState ? 'COALESCE(ss.score, 0) DESC,' : '';
  const prefixExclusion = buildExclusionClause(excludedIds, 's.id');
  const categorySql = category
    ? `
          AND EXISTS (
            SELECT 1
            FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
            WHERE sc.category_slug = ?
              AND sc.skill_id = s.id
          )
    `
    : '';
  const categoryParams = category ? [category] : [];
  const prefixParams = buildLowerPrefixParams(prefixRange);
  const exactQuery = query;
  const prefixLike = `${query}%`;

  const prefixRows = await db.prepare(`
    WITH prefix_ids AS (
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_name_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.name', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_slug_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.slug', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_repo_owner_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.repo_owner', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_repo_name_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.repo_name', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
    ),
    dedup_ids AS (
      SELECT id
      FROM prefix_ids
      GROUP BY id
      LIMIT ?
    )
    SELECT
      s.id,
      s.name,
      s.slug,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      a.avatar_url as authorAvatar,
      ${searchScoreSelectSql},
      s.trending_score as trendingScore,
      s.download_count_30d as downloadCount30d,
      s.download_count_90d as downloadCount90d,
      s.access_count_30d as accessCount30d,
      s.last_commit_at as lastCommitAt,
      s.updated_at as updatedAt,
      s.tier
    FROM dedup_ids d
    CROSS JOIN skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    ${searchStateJoinSql}
    WHERE s.id = d.id
      ${prefixExclusion.sql}
    ORDER BY
      CASE
        WHEN LOWER(s.name) = ? THEN 0
        WHEN LOWER(s.slug) = ? THEN 1
        WHEN LOWER(s.repo_owner) = ? THEN 2
        WHEN LOWER(s.repo_name) = ? THEN 3
        WHEN LOWER(s.name) LIKE ? THEN 4
        WHEN LOWER(s.slug) LIKE ? THEN 5
        WHEN LOWER(s.repo_owner) LIKE ? THEN 6
        WHEN LOWER(s.repo_name) LIKE ? THEN 7
        ELSE 8
      END ASC,
      ${searchScoreOrderSql}
      s.trending_score DESC
    LIMIT ?
  `).bind(
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    prefixLimit,
    ...prefixExclusion.params,
    exactQuery,
    exactQuery,
    exactQuery,
    exactQuery,
    prefixLike,
    prefixLike,
    prefixLike,
    prefixLike,
    prefixLimit
  ).all<SearchCandidateRow>();

  const merged = new Map<string, SearchCandidateRow>();
  for (const row of prefixRows.results || []) {
    merged.set(row.id, row);
  }

  const fuzzyBudget = Math.min(
    Math.max(0, fuzzyLimit - merged.size),
    Math.max(6, Math.ceil(limit / 2))
  );
  if (fuzzyBudget <= 0) {
    return Array.from(merged.values());
  }

  const fuzzyExclusion = buildExclusionClause(
    [...excludedIds, ...Array.from(merged.keys())],
    's.id'
  );
  const fuzzyHeadLimit = Math.min(
    MAX_TEXT_FUZZY_HEAD_SCAN,
    Math.max(MIN_TEXT_FUZZY_HEAD_SCAN, fuzzyBudget * TEXT_FUZZY_HEAD_SCAN_MULTIPLIER)
  );

  const fuzzyHeadRows = await db.prepare(`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      a.avatar_url as authorAvatar,
      ${searchScoreSelectSql},
      s.trending_score as trendingScore,
      s.download_count_30d as downloadCount30d,
      s.download_count_90d as downloadCount90d,
      s.access_count_30d as accessCount30d,
      s.last_commit_at as lastCommitAt,
      s.updated_at as updatedAt,
      s.tier
    FROM skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    ${searchStateJoinSql}
    WHERE s.visibility = 'public'
      ${categorySql}
      ${fuzzyExclusion.sql}
    ORDER BY
      s.trending_score DESC
    LIMIT ?
  `).bind(
    ...categoryParams,
    ...fuzzyExclusion.params,
    fuzzyHeadLimit
  ).all<SearchCandidateRow>();

  const fuzzyTargetSize = merged.size + fuzzyBudget;
  for (const row of fuzzyHeadRows.results || []) {
    if (!matchesFuzzyTextCandidate(row, query)) continue;
    if (!merged.has(row.id)) {
      merged.set(row.id, row);
    }
    if (merged.size >= fuzzyTargetSize) break;
  }

  return Array.from(merged.values());
}

async function fetchTextPrefixCandidates(
  db: D1Database,
  query: string,
  limit: number,
  useSearchState: boolean,
  excludedIds: string[],
  category: string
): Promise<SearchCandidateRow[]> {
  const prefixRange = buildPrefixRange(query);
  const prefixLimit = getCandidateLimit(limit, PREFIX_CANDIDATE_LIMIT_MULTIPLIER);
  const prefixPerColumnLimit = Math.max(limit, Math.ceil(prefixLimit / 2));
  const searchStateJoinSql = useSearchState ? 'LEFT JOIN skill_search_state ss ON ss.skill_id = s.id' : '';
  const searchScoreSelectSql = useSearchState ? 'ss.score as precomputedScore' : 'NULL as precomputedScore';
  const searchScoreOrderSql = useSearchState ? 'COALESCE(ss.score, 0) DESC,' : '';
  const prefixExclusion = buildExclusionClause(excludedIds, 's.id');
  const categorySql = category
    ? `
          AND EXISTS (
            SELECT 1
            FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
            WHERE sc.category_slug = ?
              AND sc.skill_id = s.id
          )
    `
    : '';
  const categoryParams = category ? [category] : [];
  const prefixParams = buildLowerPrefixParams(prefixRange);
  const exactQuery = query;
  const prefixLike = `${query}%`;

  const prefixRows = await db.prepare(`
    WITH prefix_ids AS (
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_name_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.name', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_slug_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.slug', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_repo_owner_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.repo_owner', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
      UNION ALL
      SELECT id FROM (
        SELECT id
        FROM skills s INDEXED BY skills_visibility_lower_repo_name_idx
        WHERE s.visibility = 'public'
          AND ${buildLowerPrefixPredicate('s.repo_name', prefixRange)}
          ${categorySql}
        LIMIT ?
      )
    ),
    dedup_ids AS (
      SELECT id
      FROM prefix_ids
      GROUP BY id
      LIMIT ?
    )
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      a.avatar_url as authorAvatar,
      ${searchScoreSelectSql},
      s.trending_score as trendingScore,
      s.download_count_30d as downloadCount30d,
      s.download_count_90d as downloadCount90d,
      s.access_count_30d as accessCount30d,
      s.last_commit_at as lastCommitAt,
      s.updated_at as updatedAt,
      s.tier
    FROM dedup_ids d
    CROSS JOIN skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    ${searchStateJoinSql}
    WHERE s.id = d.id
      ${prefixExclusion.sql}
    ORDER BY
      CASE
        WHEN LOWER(s.name) = ? THEN 0
        WHEN LOWER(s.slug) = ? THEN 1
        WHEN LOWER(s.repo_owner) = ? THEN 2
        WHEN LOWER(s.repo_name) = ? THEN 3
        WHEN LOWER(s.name) LIKE ? THEN 4
        WHEN LOWER(s.slug) LIKE ? THEN 5
        WHEN LOWER(s.repo_owner) LIKE ? THEN 6
        WHEN LOWER(s.repo_name) LIKE ? THEN 7
        ELSE 8
      END ASC,
      ${searchScoreOrderSql}
      s.trending_score DESC
    LIMIT ?
  `).bind(
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    ...prefixParams,
    ...categoryParams,
    prefixPerColumnLimit,
    prefixLimit,
    ...prefixExclusion.params,
    exactQuery,
    exactQuery,
    exactQuery,
    exactQuery,
    prefixLike,
    prefixLike,
    prefixLike,
    prefixLike,
    prefixLimit
  ).all<SearchCandidateRow>();

  return prefixRows.results || [];
}

async function fetchCategoryCandidates(
  db: D1Database,
  categorySlugs: string[],
  limit: number,
  excludedIds: string[],
  useSearchState: boolean
): Promise<SearchCandidateRow[]> {
  if (categorySlugs.length === 0) return [];

  const placeholders = categorySlugs.map(() => '?').join(',');
  const exclusion = buildExclusionClause(excludedIds, 's.id');
  const categoryLimit = getCandidateLimit(limit, CATEGORY_CANDIDATE_LIMIT_MULTIPLIER);

  const searchStateJoinSql = useSearchState ? 'LEFT JOIN skill_search_state ss ON ss.skill_id = s.id' : '';
  const searchScoreSelectSql = useSearchState ? 'ss.score as precomputedScore' : 'NULL as precomputedScore';
  const searchScoreOrderSql = useSearchState ? 'COALESCE(ss.score, 0) DESC,' : '';

  const sql = `
    WITH matched_categories AS (
      SELECT
        sc.skill_id as skillId,
        COUNT(*) as matchedCategoryCount
      FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
      WHERE sc.category_slug IN (${placeholders})
      GROUP BY sc.skill_id
    )
    SELECT
      s.id,
      s.name,
      s.slug,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.stars,
      a.avatar_url as authorAvatar,
      ${searchScoreSelectSql},
      s.trending_score as trendingScore,
      s.download_count_30d as downloadCount30d,
      s.download_count_90d as downloadCount90d,
      s.access_count_30d as accessCount30d,
      s.last_commit_at as lastCommitAt,
      s.updated_at as updatedAt,
      s.tier,
      matched.matchedCategoryCount as matchedCategoryCount
    FROM matched_categories matched
    JOIN skills s ON s.id = matched.skillId
    LEFT JOIN authors a ON s.repo_owner = a.username
    ${searchStateJoinSql}
    WHERE s.visibility = 'public'
      ${exclusion.sql}
    ORDER BY
      matched.matchedCategoryCount DESC,
      ${searchScoreOrderSql}
      s.trending_score DESC
    LIMIT ?
  `;

  const params: (string | number)[] = [
    ...categorySlugs,
    ...exclusion.params,
    categoryLimit
  ];

  const result = await db.prepare(sql).bind(...params).all<SearchCandidateRow>();
  return result.results || [];
}

async function resolveSearchTableSupport(
  db: D1Database
): Promise<{ searchState: boolean; searchTerms: boolean; searchPrefixes: boolean }> {
  if (
    hasSkillSearchStateTable !== null
    && hasSkillSearchTermsTable !== null
    && hasSkillSearchPrefixesTable !== null
  ) {
    return {
      searchState: hasSkillSearchStateTable,
      searchTerms: hasSkillSearchTermsTable,
      searchPrefixes: hasSkillSearchPrefixesTable,
    };
  }

  try {
    const result = await db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name IN ('skill_search_state', 'skill_search_terms', 'skill_search_prefixes')
    `).all<{ name: string }>();

    const names = new Set((result.results || []).map((row) => row.name));
    hasSkillSearchStateTable = names.has('skill_search_state');
    hasSkillSearchTermsTable = names.has('skill_search_terms');
    hasSkillSearchPrefixesTable = names.has('skill_search_prefixes');
  } catch {
    hasSkillSearchStateTable = false;
    hasSkillSearchTermsTable = false;
    hasSkillSearchPrefixesTable = false;
  }

  return {
    searchState: Boolean(hasSkillSearchStateTable),
    searchTerms: Boolean(hasSkillSearchTermsTable),
    searchPrefixes: Boolean(hasSkillSearchPrefixesTable),
  };
}

async function fetchSuggestions(
  db: D1Database,
  query: string,
  limit: number,
  category: string
): Promise<SearchSuggestionsResult> {
  const tableSupport = await resolveSearchTableSupport(db);
  const queryTokens = splitQueryTokens(query);
  const prefixTokens = buildSuggestionPrefixTokens(queryTokens);
  const hasLongPrefixToken = queryTokens.some((token) => token.length > SEARCH_SUGGESTION_MAX_PREFIX_LENGTH);

  const matchedCategories = category ? [] : matchCategories(query);
  const matchedCategorySlugs = matchedCategories.map((item) => item.slug);
  const matchedCategoryMap = new Map(matchedCategorySlugs.map((slug, index) => [slug, index]));
  const matchedCategoryItems = CATEGORIES
    .filter((category) => matchedCategoryMap.has(category.slug))
    .sort((a, b) => (matchedCategoryMap.get(a.slug) ?? 0) - (matchedCategoryMap.get(b.slug) ?? 0));

  const textCandidates = new Map<string, SearchCandidateRow>();
  const usedPrefixIndex = tableSupport.searchPrefixes && prefixTokens.length > 0;

  if (usedPrefixIndex) {
    const prefixCandidates = await fetchPrefixCandidates(db, prefixTokens, limit, tableSupport.searchState, category);
    for (const row of prefixCandidates) {
      textCandidates.set(row.id, row);
    }
  }

  const shouldFallbackToTermIndex = (
    tableSupport.searchTerms
    && queryTokens.length > 0
    && (!usedPrefixIndex || textCandidates.size === 0)
  );

  if (shouldFallbackToTermIndex) {
    const termCandidates = await fetchTermCandidates(db, queryTokens, limit, tableSupport.searchState, category);
    for (const row of termCandidates) {
      textCandidates.set(row.id, row);
    }
  }

  if (usedPrefixIndex && hasLongPrefixToken) {
    const precisionRows = await fetchTextPrefixCandidates(
      db,
      query,
      limit,
      tableSupport.searchState,
      Array.from(textCandidates.keys()),
      category
    );

    for (const row of precisionRows) {
      if (!textCandidates.has(row.id)) {
        textCandidates.set(row.id, row);
      }
    }
  }

  const shouldUseTextFallback = (
    textCandidates.size < limit
    && (!usedPrefixIndex || textCandidates.size === 0)
    && (!tableSupport.searchTerms || !category || textCandidates.size === 0)
  );
  if (textCandidates.size < limit && shouldUseTextFallback) {
    const fallbackRows = await fetchTextCandidates(
      db,
      query,
      limit,
      tableSupport.searchState,
      Array.from(textCandidates.keys()),
      category
    );

    for (const row of fallbackRows) {
      if (!textCandidates.has(row.id)) {
        textCandidates.set(row.id, row);
      }
    }
  }

  const mergedTextCandidates = Array.from(textCandidates.values());
  const categoryCandidates = category
    ? []
    : await fetchCategoryCandidates(
      db,
      matchedCategorySlugs,
      limit,
      mergedTextCandidates.map((row) => row.id),
      tableSupport.searchState
    );

  const rankedSkills = rankCandidates(query, queryTokens, mergedTextCandidates, categoryCandidates, limit);
  return {
    skills: rankedSkills,
    categories: matchedCategoryItems,
    total: rankedSkills.length
  };
}

export const GET: RequestHandler = async ({ url, platform }) => {
  try {
    const query = normalizeText((url.searchParams.get('q') || '').slice(0, MAX_QUERY_LENGTH));
    const category = normalizeCategory(url.searchParams.get('category'));
    const limit = parseLimit(url.searchParams.get('pageSize') ?? url.searchParams.get('limit'));
    const cacheLimit = normalizeSearchCacheLimit(limit);
    const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

    if (!query || query.length < MIN_QUERY_LENGTH) {
      return json({
        success: true,
        data: {
          skills: [],
          categories: []
        },
        meta: { total: 0 }
      });
    }

    const db = platform?.env?.DB;
    const { data, hit } = await getCached(
      `api:search:${SEARCH_CACHE_KEY_VERSION}:${query}:${category || '_'}:${cacheLimit}`,
      async () => {
        if (!db) {
          return { skills: [], categories: [], total: 0 } satisfies SearchSuggestionsResult;
        }

        try {
          return await fetchSuggestions(db, query, cacheLimit, category);
        } catch {
          return { skills: [], categories: [], total: 0 } satisfies SearchSuggestionsResult;
        }
      },
      SEARCH_CACHE_TTL_SECONDS,
      { waitUntil }
    );
    const skills = data.skills.slice(0, limit);

    return json({
      success: true,
      data: {
        skills,
        categories: data.categories
      },
      meta: {
        total: skills.length
      }
    } satisfies ApiResponse<{ skills: SearchSuggestionSkill[]; categories: SearchSuggestionCategory[] }>, {
      headers: {
        'Cache-Control': `public, max-age=${SEARCH_CACHE_TTL_SECONDS}, stale-while-revalidate=3600`,
        'X-Cache': hit ? 'HIT' : 'MISS'
      }
    });
  } catch (error) {
    console.error('Error searching:', error);
    return json({
      success: false,
      error: 'Search failed'
    } satisfies ApiResponse<never>, { status: 500 });
  }
};
