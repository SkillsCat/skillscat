/**
 * Search/Recommend Precompute Worker
 *
 * Dedicated offline worker for:
 * 1) recommend skills precompute refresh
 * 2) search quality score precompute refresh
 *
 * This keeps the trending worker focused on list/trending updates and reduces
 * per-worker CPU pressure.
 */

import type { ExecutionContext, ScheduledController, SearchPrecomputeEnv } from './shared/types';
import { normalizeRecommendAlgoVersion } from '../src/lib/server/ranking/recommend-precompute';
import {
  buildSearchTermEntries,
  computeSearchScore,
  normalizeSearchAlgoVersion,
  replaceSearchTermsForSkill,
  upsertSearchStateFailure,
  upsertSearchStateSuccess,
} from '../src/lib/server/ranking/search-precompute';

const DEFAULT_RECOMMEND_PRECOMPUTE_MAX_PER_RUN = 200;
const DEFAULT_RECOMMEND_PRECOMPUTE_TIME_BUDGET_MS = 15_000;
const DEFAULT_RECOMMEND_PRECOMPUTE_REQUEST_TIMEOUT_MS = 2_500;
const DEFAULT_SEARCH_PRECOMPUTE_MAX_PER_RUN = 500;
const DEFAULT_SEARCH_PRECOMPUTE_TIME_BUDGET_MS = 10_000;
const DEFAULT_SITEMAP_REFRESH_TIMEOUT_MS = 20_000;
const SITEMAP_PREWARM_CONCURRENCY = 4;
const DEFAULT_MISSING_STATE_SCAN_HOUR_UTC = 3;
const DEFAULT_MISSING_STATE_SCAN_LIMIT = 200;

interface RecommendPrecomputeCandidate {
  id: string;
  slug: string;
  tier: string;
  trending_score: number;
  last_accessed_at: number | null;
  dirty: number | null;
  next_update_at: number | null;
  precomputed_at: number | null;
  algo_version: string | null;
}

interface SearchPrecomputeCandidate {
  id: string;
  name: string;
  slug: string;
  repo_owner: string | null;
  repo_name: string | null;
  description: string | null;
  categories_json: string | null;
  tags_json: string | null;
  tier: string;
  stars: number;
  trending_score: number | null;
  download_count_30d: number | null;
  download_count_90d: number | null;
  access_count_30d: number | null;
  last_commit_at: number | null;
  updated_at: number | null;
  dirty: number | null;
  next_update_at: number | null;
  precomputed_at: number | null;
  algo_version: string | null;
}

interface SitemapRefreshResponsePayload {
  skipped?: boolean;
  paths?: unknown;
}

interface SitemapRefreshResult {
  status: 'refreshed' | 'skipped' | 'disabled' | 'failed';
  paths: string[];
}

function isRecommendPrecomputeEnabled(env: SearchPrecomputeEnv): boolean {
  return (env.RECOMMEND_PRECOMPUTE_ENABLED || '1').trim() !== '0';
}

function getRecommendPrecomputeMaxPerRun(env: SearchPrecomputeEnv): number {
  const parsed = Number.parseInt(env.RECOMMEND_PRECOMPUTE_MAX_PER_RUN || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECOMMEND_PRECOMPUTE_MAX_PER_RUN;
  return Math.min(parsed, 2000);
}

function getRecommendPrecomputeTimeBudgetMs(env: SearchPrecomputeEnv): number {
  const parsed = Number.parseInt(env.RECOMMEND_PRECOMPUTE_TIME_BUDGET_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECOMMEND_PRECOMPUTE_TIME_BUDGET_MS;
  return Math.min(parsed, 120_000);
}

function getRecommendPrecomputeRequestTimeoutMs(env: SearchPrecomputeEnv): number {
  const parsed = Number.parseInt(env.RECOMMEND_PRECOMPUTE_REQUEST_TIMEOUT_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECOMMEND_PRECOMPUTE_REQUEST_TIMEOUT_MS;
  return Math.min(Math.max(parsed, 300), 10_000);
}

function getAppOrigin(env: SearchPrecomputeEnv): string | null {
  const origin = (env.APP_ORIGIN || '').trim();
  if (!origin) return null;
  return origin.replace(/\/+$/, '');
}

function buildRecommendRefreshUrl(appOrigin: string, slug: string): string | null {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, ...nameParts] = parts;
  const encodedOwner = encodeURIComponent(owner);
  const encodedName = nameParts.map((part) => encodeURIComponent(part)).join('/');
  return `${appOrigin}/api/skills/${encodedOwner}/${encodedName}/recommend?refresh=1`;
}

async function processRecommendPrecomputeBatch(env: SearchPrecomputeEnv): Promise<{ attempted: number; succeeded: number; failed: number; skipped: number }> {
  if (!isRecommendPrecomputeEnabled(env)) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const appOrigin = getAppOrigin(env);
  if (!appOrigin) {
    console.warn('Recommend precompute enabled but APP_ORIGIN is not configured');
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const now = Date.now();
  const algoVersion = normalizeRecommendAlgoVersion(env.RECOMMEND_ALGO_VERSION);
  const limit = getRecommendPrecomputeMaxPerRun(env);
  const timeBudgetMs = getRecommendPrecomputeTimeBudgetMs(env);
  const requestTimeoutMs = getRecommendPrecomputeRequestTimeoutMs(env);
  const recommendMissingScanHour = parseMissingStateScanHour(env.RECOMMEND_MISSING_STATE_SCAN_HOUR_UTC);
  const recommendMissingScanLimit = parseMissingStateScanLimit(env.RECOMMEND_MISSING_STATE_SCAN_LIMIT);
  const includeRecommendMissingStateScan = shouldRunMissingStateScan(now, recommendMissingScanHour);

  let candidatesResult;
  try {
    // Avoid version-mismatch inequality scans here: `algo_version != ?` forces a
    // full scan of the state table in SQLite/D1. Dirty/null/due state still
    // drives background refresh, and recommend requests can backfill on access.
    if (includeRecommendMissingStateScan) {
      candidatesResult = await env.DB.prepare(`
        WITH state_candidates AS (
          SELECT skill_id FROM skill_recommend_state WHERE dirty = 1
          UNION
          SELECT skill_id FROM skill_recommend_state WHERE precomputed_at IS NULL
          UNION
          SELECT skill_id FROM skill_recommend_state WHERE next_update_at <= ?
          UNION
          SELECT skill_id FROM skill_recommend_state WHERE algo_version IS NULL
        ),
        missing_state AS (
          SELECT s.id as skill_id
          FROM skills s INDEXED BY skills_public_non_archived_indexed_idx
          LEFT JOIN skill_recommend_state rs ON rs.skill_id = s.id
          WHERE rs.skill_id IS NULL
            AND s.visibility = 'public'
            AND s.tier != 'archived'
          ORDER BY s.indexed_at DESC
          LIMIT ?
        ),
        candidate_ids AS (
          SELECT skill_id FROM state_candidates
          UNION
          SELECT skill_id FROM missing_state
        )
        SELECT
          s.id,
          s.slug,
          s.tier,
          s.trending_score,
          s.last_accessed_at,
          rs.dirty,
          rs.next_update_at,
          rs.precomputed_at,
          rs.algo_version
        FROM candidate_ids c
        JOIN skills s ON s.id = c.skill_id
        LEFT JOIN skill_recommend_state rs ON rs.skill_id = s.id
        WHERE s.visibility = 'public'
          AND s.tier != 'archived'
        ORDER BY
          COALESCE(rs.dirty, 1) DESC,
          CASE s.tier
            WHEN 'hot' THEN 0
            WHEN 'warm' THEN 1
            WHEN 'cool' THEN 2
            WHEN 'cold' THEN 3
            ELSE 4
          END ASC,
          s.trending_score DESC,
          CASE WHEN s.last_accessed_at IS NULL THEN 1 ELSE 0 END ASC,
          s.last_accessed_at DESC,
          COALESCE(rs.next_update_at, 0) ASC
        LIMIT ?
      `)
        .bind(now, recommendMissingScanLimit, limit)
        .all<RecommendPrecomputeCandidate>();
    } else {
      candidatesResult = await env.DB.prepare(`
        WITH state_candidates AS (
          SELECT skill_id FROM skill_recommend_state WHERE dirty = 1
          UNION
          SELECT skill_id FROM skill_recommend_state WHERE precomputed_at IS NULL
          UNION
          SELECT skill_id FROM skill_recommend_state WHERE next_update_at <= ?
          UNION
          SELECT skill_id FROM skill_recommend_state WHERE algo_version IS NULL
        ),
        candidate_ids AS (
          SELECT skill_id FROM state_candidates
        )
        SELECT
          s.id,
          s.slug,
          s.tier,
          s.trending_score,
          s.last_accessed_at,
          rs.dirty,
          rs.next_update_at,
          rs.precomputed_at,
          rs.algo_version
        FROM candidate_ids c
        JOIN skills s ON s.id = c.skill_id
        LEFT JOIN skill_recommend_state rs ON rs.skill_id = s.id
        WHERE s.visibility = 'public'
          AND s.tier != 'archived'
        ORDER BY
          COALESCE(rs.dirty, 1) DESC,
          CASE s.tier
            WHEN 'hot' THEN 0
            WHEN 'warm' THEN 1
            WHEN 'cool' THEN 2
            WHEN 'cold' THEN 3
            ELSE 4
          END ASC,
          s.trending_score DESC,
          CASE WHEN s.last_accessed_at IS NULL THEN 1 ELSE 0 END ASC,
          s.last_accessed_at DESC,
          COALESCE(rs.next_update_at, 0) ASC
        LIMIT ?
      `)
        .bind(now, limit)
        .all<RecommendPrecomputeCandidate>();
    }
  } catch (err) {
    console.warn('Recommend precompute query failed (migration may not be applied yet):', err);
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const candidates = candidatesResult.results || [];
  if (candidates.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const startedAt = Date.now();

  for (const candidate of candidates) {
    if (Date.now() - startedAt >= timeBudgetMs) {
      break;
    }

    const refreshUrl = buildRecommendRefreshUrl(appOrigin, candidate.slug);
    if (!refreshUrl) {
      skipped++;
      continue;
    }

    attempted++;

    try {
      const headers: HeadersInit = {};
      if (env.WORKER_SECRET) {
        headers.Authorization = `Bearer ${env.WORKER_SECRET}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response: Response;
      try {
        response = await fetch(refreshUrl, { method: 'GET', headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        failed++;
        const body = await response.text();
        console.warn(`Recommend precompute refresh failed for ${candidate.slug}: ${response.status} ${body.slice(0, 200)}`);
        continue;
      }

      succeeded++;
    } catch (err) {
      failed++;
      console.warn(`Recommend precompute request error for ${candidate.slug}:`, err);
    }
  }

  return { attempted, succeeded, failed, skipped };
}

function isSearchPrecomputeEnabled(env: SearchPrecomputeEnv): boolean {
  return (env.SEARCH_PRECOMPUTE_ENABLED || '1').trim() !== '0';
}

function getSearchPrecomputeMaxPerRun(env: SearchPrecomputeEnv): number {
  const parsed = Number.parseInt(env.SEARCH_PRECOMPUTE_MAX_PER_RUN || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SEARCH_PRECOMPUTE_MAX_PER_RUN;
  return Math.min(parsed, 5000);
}

function getSearchPrecomputeTimeBudgetMs(env: SearchPrecomputeEnv): number {
  const parsed = Number.parseInt(env.SEARCH_PRECOMPUTE_TIME_BUDGET_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SEARCH_PRECOMPUTE_TIME_BUDGET_MS;
  return Math.min(parsed, 120_000);
}

function parseMissingStateScanHour(raw: string | undefined): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MISSING_STATE_SCAN_HOUR_UTC;
  return Math.min(23, Math.max(0, parsed));
}

function parseMissingStateScanLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MISSING_STATE_SCAN_LIMIT;
  return Math.min(parsed, 2000);
}

function isSitemapRefreshEnabled(env: SearchPrecomputeEnv): boolean {
  return (env.SITEMAP_REFRESH_ENABLED || '1').trim() !== '0';
}

function getSitemapRefreshTimeoutMs(env: SearchPrecomputeEnv): number {
  const parsed = Number.parseInt(env.SITEMAP_REFRESH_TIMEOUT_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SITEMAP_REFRESH_TIMEOUT_MS;
  return Math.min(Math.max(parsed, 1000), 120_000);
}

function normalizeSitemapPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) {
    return [];
  }

  return Array.from(new Set(
    paths.filter((path): path is string => typeof path === 'string' && /^\/[^\s]*$/.test(path))
  ));
}

async function refreshSitemaps(env: SearchPrecomputeEnv): Promise<SitemapRefreshResult> {
  if (!isSitemapRefreshEnabled(env)) {
    return { status: 'disabled', paths: [] };
  }

  const appOrigin = getAppOrigin(env);
  if (!appOrigin) {
    console.warn('Sitemap refresh enabled but APP_ORIGIN is not configured');
    return { status: 'failed', paths: [] };
  }

  if (!env.WORKER_SECRET) {
    console.warn('Sitemap refresh enabled but WORKER_SECRET is not configured');
    return { status: 'failed', paths: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getSitemapRefreshTimeoutMs(env));

  try {
    const response = await fetch(`${appOrigin}/api/admin/seo/sitemaps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WORKER_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scope: 'all' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(`Sitemap refresh failed: ${response.status} ${body.slice(0, 200)}`);
      return { status: 'failed', paths: [] };
    }

    const payload = await response.json().catch(() => null) as SitemapRefreshResponsePayload | null;
    return {
      status: payload?.skipped ? 'skipped' : 'refreshed',
      paths: normalizeSitemapPaths(payload?.paths),
    };
  } catch (err) {
    console.warn('Sitemap refresh request error:', err);
    return { status: 'failed', paths: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function prewarmSitemapRoutes(
  env: SearchPrecomputeEnv,
  paths: string[]
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const appOrigin = getAppOrigin(env);
  if (!appOrigin) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const sitemapPaths = normalizeSitemapPaths(paths);
  if (sitemapPaths.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const requestTimeoutMs = getSitemapRefreshTimeoutMs(env);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < sitemapPaths.length; index += SITEMAP_PREWARM_CONCURRENCY) {
    const batch = sitemapPaths.slice(index, index + SITEMAP_PREWARM_CONCURRENCY);

    await Promise.all(batch.map(async (path) => {
      attempted += 1;

      // Force a revalidation so the public HTTP cache sees the fresh snapshot as soon as it lands.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const response = await fetch(`${appOrigin}${path}`, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            'User-Agent': 'SkillsCat-Sitemap-Prewarm/1.0',
            'X-Sitemap-Prewarm': '1',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await response.arrayBuffer();
        succeeded += 1;
      } catch (error) {
        failed += 1;
        console.warn(`Sitemap prewarm failed for ${path}:`, error);
      } finally {
        clearTimeout(timeout);
      }
    }));
  }

  return { attempted, succeeded, failed };
}

function shouldRunMissingStateScan(now: number, hourUtc: number): boolean {
  return new Date(now).getUTCHours() === hourUtc;
}

async function hasTable(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 as has_table
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `)
    .bind(tableName)
    .first<{ has_table: number }>();
  return Boolean(row);
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

async function processSearchPrecomputeBatch(env: SearchPrecomputeEnv): Promise<{ attempted: number; succeeded: number; failed: number; skipped: number }> {
  if (!isSearchPrecomputeEnabled(env)) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const now = Date.now();
  const algoVersion = normalizeSearchAlgoVersion(env.SEARCH_PRECOMPUTE_ALGO_VERSION);
  const limit = getSearchPrecomputeMaxPerRun(env);
  const timeBudgetMs = getSearchPrecomputeTimeBudgetMs(env);
  const searchMissingScanHour = parseMissingStateScanHour(env.SEARCH_MISSING_STATE_SCAN_HOUR_UTC);
  const searchMissingScanLimit = parseMissingStateScanLimit(env.SEARCH_MISSING_STATE_SCAN_LIMIT);
  const includeSearchMissingStateScan = shouldRunMissingStateScan(now, searchMissingScanHour);
  const searchTermsEnabled = await hasTable(env.DB, 'skill_search_terms').catch(() => false);
  if (!searchTermsEnabled) {
    console.warn('Search precompute term index table missing; quality score precompute will continue without terms');
  }

  let candidatesResult;
  try {
    if (includeSearchMissingStateScan) {
      candidatesResult = await env.DB.prepare(`
        WITH state_candidates AS (
          SELECT skill_id FROM skill_search_state WHERE dirty = 1
          UNION
          SELECT skill_id FROM skill_search_state WHERE precomputed_at IS NULL
          UNION
          SELECT skill_id FROM skill_search_state WHERE next_update_at IS NULL
          UNION
          SELECT skill_id FROM skill_search_state WHERE next_update_at <= ?
          UNION
          SELECT skill_id FROM skill_search_state WHERE algo_version IS NULL
        ),
        missing_state AS (
          SELECT s.id as skill_id
          FROM skills s INDEXED BY skills_public_non_archived_indexed_idx
          LEFT JOIN skill_search_state ss ON ss.skill_id = s.id
          WHERE ss.skill_id IS NULL
            AND s.visibility = 'public'
            AND s.tier != 'archived'
          ORDER BY s.indexed_at DESC
          LIMIT ?
        ),
        candidate_ids AS (
          SELECT skill_id FROM state_candidates
          UNION
          SELECT skill_id FROM missing_state
        )
        SELECT
          s.id,
          s.name,
          s.slug,
          s.repo_owner,
          s.repo_name,
          s.description,
          (
            SELECT json_group_array(sc.category_slug)
            FROM skill_categories sc
            WHERE sc.skill_id = s.id
          ) as categories_json,
          (
            SELECT json_group_array(st.tag)
            FROM skill_tags st
            WHERE st.skill_id = s.id
          ) as tags_json,
          s.tier,
          s.stars,
          s.trending_score,
          s.download_count_30d,
          s.download_count_90d,
          s.access_count_30d,
          s.last_commit_at,
          s.updated_at,
          ss.dirty,
          ss.next_update_at,
          ss.precomputed_at,
          ss.algo_version
        FROM candidate_ids c
        JOIN skills s ON s.id = c.skill_id
        LEFT JOIN skill_search_state ss ON ss.skill_id = s.id
        WHERE s.visibility = 'public'
          AND s.tier != 'archived'
        ORDER BY
          COALESCE(ss.dirty, 1) DESC,
          CASE s.tier
            WHEN 'hot' THEN 0
            WHEN 'warm' THEN 1
            WHEN 'cool' THEN 2
            WHEN 'cold' THEN 3
            ELSE 4
          END ASC,
          s.trending_score DESC,
          COALESCE(ss.next_update_at, 0) ASC
        LIMIT ?
      `)
        .bind(now, searchMissingScanLimit, limit)
        .all<SearchPrecomputeCandidate>();
    } else {
      candidatesResult = await env.DB.prepare(`
        WITH state_candidates AS (
          SELECT skill_id FROM skill_search_state WHERE dirty = 1
          UNION
          SELECT skill_id FROM skill_search_state WHERE precomputed_at IS NULL
          UNION
          SELECT skill_id FROM skill_search_state WHERE next_update_at IS NULL
          UNION
          SELECT skill_id FROM skill_search_state WHERE next_update_at <= ?
          UNION
          SELECT skill_id FROM skill_search_state WHERE algo_version IS NULL
        ),
        candidate_ids AS (
          SELECT skill_id FROM state_candidates
        )
        SELECT
          s.id,
          s.name,
          s.slug,
          s.repo_owner,
          s.repo_name,
          s.description,
          (
            SELECT json_group_array(sc.category_slug)
            FROM skill_categories sc
            WHERE sc.skill_id = s.id
          ) as categories_json,
          (
            SELECT json_group_array(st.tag)
            FROM skill_tags st
            WHERE st.skill_id = s.id
          ) as tags_json,
          s.tier,
          s.stars,
          s.trending_score,
          s.download_count_30d,
          s.download_count_90d,
          s.access_count_30d,
          s.last_commit_at,
          s.updated_at,
          ss.dirty,
          ss.next_update_at,
          ss.precomputed_at,
          ss.algo_version
        FROM candidate_ids c
        JOIN skills s ON s.id = c.skill_id
        LEFT JOIN skill_search_state ss ON ss.skill_id = s.id
        WHERE s.visibility = 'public'
          AND s.tier != 'archived'
        ORDER BY
          COALESCE(ss.dirty, 1) DESC,
          CASE s.tier
            WHEN 'hot' THEN 0
            WHEN 'warm' THEN 1
            WHEN 'cool' THEN 2
            WHEN 'cold' THEN 3
            ELSE 4
          END ASC,
          s.trending_score DESC,
          COALESCE(ss.next_update_at, 0) ASC
        LIMIT ?
      `)
        .bind(now, limit)
        .all<SearchPrecomputeCandidate>();
    }
  } catch (err) {
    console.warn('Search precompute query failed (migration may not be applied yet):', err);
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const candidates = candidatesResult.results || [];
  if (candidates.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const startedAt = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    if (Date.now() - startedAt >= timeBudgetMs) {
      skipped += candidates.length - i;
      break;
    }

    const candidate = candidates[i];
    if (!candidate.id) {
      skipped++;
      continue;
    }

    attempted++;

    try {
      const score = computeSearchScore({
        stars: candidate.stars,
        trendingScore: candidate.trending_score,
        downloadCount30d: candidate.download_count_30d,
        downloadCount90d: candidate.download_count_90d,
        accessCount30d: candidate.access_count_30d,
        lastCommitAt: candidate.last_commit_at,
        updatedAt: candidate.updated_at,
        tier: candidate.tier
      }, now);

      if (searchTermsEnabled) {
        const terms = buildSearchTermEntries({
          name: candidate.name,
          slug: candidate.slug,
          repoOwner: candidate.repo_owner,
          repoName: candidate.repo_name,
          description: candidate.description,
          categories: parseJsonStringArray(candidate.categories_json),
          tags: parseJsonStringArray(candidate.tags_json)
        });

        await replaceSearchTermsForSkill(env.DB, {
          skillId: candidate.id,
          terms,
          now
        });
      }

      await upsertSearchStateSuccess(env.DB, {
        skillId: candidate.id,
        tier: candidate.tier,
        algoVersion,
        score,
        now
      });
      succeeded++;
    } catch (err) {
      failed++;
      console.warn(`Search precompute failed for skill ${candidate.id}:`, err);
      try {
        await upsertSearchStateFailure(env.DB, { skillId: candidate.id, now });
      } catch (stateErr) {
        console.warn(`Failed to record search precompute failure for ${candidate.id}:`, stateErr);
      }
    }
  }

  return { attempted, succeeded, failed, skipped };
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: SearchPrecomputeEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Search/Recommend precompute worker triggered at:', new Date().toISOString());

    const search = await processSearchPrecomputeBatch(env);
    if (search.attempted > 0 || search.skipped > 0) {
      console.log(`Search precompute: attempted=${search.attempted}, succeeded=${search.succeeded}, failed=${search.failed}, skipped=${search.skipped}`);
    }

    const recommend = await processRecommendPrecomputeBatch(env);
    if (recommend.attempted > 0 || recommend.skipped > 0) {
      console.log(`Recommend precompute: attempted=${recommend.attempted}, succeeded=${recommend.succeeded}, failed=${recommend.failed}, skipped=${recommend.skipped}`);
    }

    const sitemapRefreshResult = await refreshSitemaps(env);
    if (sitemapRefreshResult.status === 'refreshed') {
      console.log('Sitemap refresh completed');

      const sitemapPrewarm = await prewarmSitemapRoutes(env, sitemapRefreshResult.paths);
      if (sitemapPrewarm.attempted > 0) {
        console.log(`Sitemap prewarm: attempted=${sitemapPrewarm.attempted}, succeeded=${sitemapPrewarm.succeeded}, failed=${sitemapPrewarm.failed}`);
      }
    } else if (sitemapRefreshResult.status === 'skipped') {
      console.log('Sitemap refresh skipped by minimum interval');
    }
  },
};
