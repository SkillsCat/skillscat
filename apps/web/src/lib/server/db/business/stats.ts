import { LIST_CACHE_MAX_AGE_MS, PREDEFINED_CATEGORY_SLUGS } from '$lib/server/db/shared/constants';
import { buildListCacheKeys } from '$lib/server/db/shared/cache';
import type { DbEnv } from '$lib/server/db/shared/types';

interface CategoryCountRow {
  category_slug: string;
  count: number;
  max_ts?: number | null;
}

interface CategoryAggregateRow {
  category_slug: string;
  count: number;
  max_ts: number | null;
}

interface CategoryTopSkillRow {
  skillId: string;
}

interface TableInfoRow {
  name: string;
}

interface CategoryPublicStatsColumnSupport {
  topSkillIdsJson: boolean;
  topRankedSkillIdsJson: boolean;
}

interface CategoryStatsCompletenessRow {
  count: number;
}

export interface DynamicCategoryStat {
  slug: string;
  name: string;
  description: string | null;
  type: string;
  skillCount: number;
}

export interface PublicStats {
  totalSkills: number;
}

interface PublicStatsCachePayload {
  data?: PublicStats;
  generatedAt?: number;
}

let pendingPredefinedCategoryStatsSync: Promise<void> | null = null;
const CATEGORY_PUBLIC_TOP_SKILL_IDS_LIMIT = 96;
const PUBLIC_STATS_CACHE_KEY = 'stats/public';
const PUBLIC_STATS_CACHE_MAX_AGE_MS = LIST_CACHE_MAX_AGE_MS;
const categoryPublicStatsColumnSupportCache = new WeakMap<object, CategoryPublicStatsColumnSupport>();

function normalizeCategorySlugs(categorySlugs: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(categorySlugs).filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
    )
  );
}

async function readStoredCategoryStats(
  db: D1Database,
  categorySlugs: string[]
): Promise<CategoryCountRow[]> {
  if (categorySlugs.length === 0) return [];

  const placeholders = categorySlugs.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT category_slug, public_skill_count AS count
    FROM category_public_stats
    WHERE category_slug IN (${placeholders})
  `)
    .bind(...categorySlugs)
    .all<CategoryCountRow>();

  return result.results || [];
}

async function loadCategoryAggregates(
  db: D1Database,
  categorySlugs: string[]
): Promise<Map<string, { count: number; maxTs: number | null }>> {
  if (categorySlugs.length === 0) {
    return new Map();
  }

  const placeholders = categorySlugs.map(() => '?').join(',');
  const aggregated = await db.prepare(`
    SELECT
      sc.category_slug AS category_slug,
      COUNT(*) AS count,
      MAX(CASE WHEN s.last_commit_at IS NULL THEN s.updated_at ELSE s.last_commit_at END) AS max_ts
    FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
    JOIN skills s
      ON s.id = sc.skill_id
     AND s.visibility = 'public'
    WHERE sc.category_slug IN (${placeholders})
    GROUP BY sc.category_slug
  `)
    .bind(...categorySlugs)
    .all<CategoryAggregateRow>();

  return new Map(
    (aggregated.results || []).map((row) => [
      row.category_slug,
      {
        count: Number(row.count) || 0,
        maxTs: row.max_ts == null ? null : Number(row.max_ts),
      },
    ])
  );
}

async function loadTopSkillIdsForCategory(
  db: D1Database,
  categorySlug: string,
  limit: number = CATEGORY_PUBLIC_TOP_SKILL_IDS_LIMIT
): Promise<string[]> {
  if (!categorySlug || limit <= 0) return [];

  const result = await db.prepare(`
    SELECT sc.skill_id as skillId
    FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
    CROSS JOIN skills s INDEXED BY skills_visibility_id_idx
    WHERE sc.category_slug = ?
      AND s.id = sc.skill_id
      AND s.visibility = 'public'
    ORDER BY s.trending_score DESC
    LIMIT ?
  `)
    .bind(categorySlug, limit)
    .all<CategoryTopSkillRow>();

  return (result.results || [])
    .map((row) => row.skillId)
    .filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0);
}

async function loadTopRankedSkillIdsForCategory(
  db: D1Database,
  categorySlug: string,
  limit: number = CATEGORY_PUBLIC_TOP_SKILL_IDS_LIMIT
): Promise<string[]> {
  if (!categorySlug || limit <= 0) return [];

  const result = await db.prepare(`
    SELECT sc.skill_id as skillId
    FROM skill_categories sc INDEXED BY skill_categories_category_skill_idx
    CROSS JOIN skills s INDEXED BY skills_visibility_id_idx
    WHERE sc.category_slug = ?
      AND s.id = sc.skill_id
      AND s.visibility = 'public'
    ORDER BY CASE
      WHEN s.classification_method = 'direct' THEN 0
      WHEN s.classification_method = 'ai' THEN 1
      WHEN s.classification_method = 'keyword' THEN 2
      ELSE 3
    END ASC,
    s.trending_score DESC
    LIMIT ?
  `)
    .bind(categorySlug, limit)
    .all<CategoryTopSkillRow>();

  return (result.results || [])
    .map((row) => row.skillId)
    .filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0);
}

async function getCategoryPublicStatsColumnSupport(
  db: D1Database
): Promise<CategoryPublicStatsColumnSupport> {
  const cached = categoryPublicStatsColumnSupportCache.get(db as object);
  if (cached) {
    return cached;
  }

  try {
    const result = await db.prepare(`PRAGMA table_info(category_public_stats)`).all<TableInfoRow>();
    const columns = new Set((result.results || []).map((row) => row.name));
    const support = {
      topSkillIdsJson: columns.has('top_skill_ids_json'),
      topRankedSkillIdsJson: columns.has('top_ranked_skill_ids_json'),
    };
    categoryPublicStatsColumnSupportCache.set(db as object, support);
    return support;
  } catch {
    const support = {
      topSkillIdsJson: false,
      topRankedSkillIdsJson: false,
    };
    categoryPublicStatsColumnSupportCache.set(db as object, support);
    return support;
  }
}

function buildCategoryStatsRecord(rows: Iterable<CategoryCountRow>): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const row of rows) {
    if (typeof row.category_slug === 'string' && row.category_slug.length > 0) {
      stats[row.category_slug] = Number(row.count) || 0;
    }
  }

  return stats;
}

function buildCategoryStatsRecordFromAggregates(
  categorySlugs: Iterable<string>,
  aggregateMap: Map<string, { count: number }>
): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const slug of categorySlugs) {
    if (typeof slug === 'string' && slug.length > 0) {
      stats[slug] = aggregateMap.get(slug)?.count ?? 0;
    }
  }

  return stats;
}

export async function readCachedPublicStats(
  r2: R2Bucket | undefined,
  cacheVersion?: string,
  maxAgeMs: number = PUBLIC_STATS_CACHE_MAX_AGE_MS
): Promise<PublicStats | null> {
  if (!r2) return null;

  try {
    const cacheKeys = buildListCacheKeys(PUBLIC_STATS_CACHE_KEY, cacheVersion);
    const primaryKey = cacheKeys[0];

    for (const cacheKey of cacheKeys) {
      const object = await r2.get(cacheKey);
      if (!object) continue;

      const text = await object.text();
      const parsed = JSON.parse(text) as PublicStatsCachePayload;
      const totalSkills = Number(parsed.data?.totalSkills);
      const generatedAt = Number(parsed.generatedAt);

      if (!Number.isFinite(totalSkills) || totalSkills < 0) continue;
      if (!Number.isFinite(generatedAt) || generatedAt <= 0) continue;

      if (maxAgeMs > 0 && Date.now() - generatedAt > maxAgeMs) {
        void r2.delete(cacheKey);
        continue;
      }

      if (cacheKey !== primaryKey) {
        void r2.put(primaryKey, text, {
          httpMetadata: { contentType: 'application/json' },
        });
      }

      return { totalSkills };
    }
  } catch (error) {
    console.error('Failed to read cached public stats:', error);
  }

  return null;
}

export async function writeCachedPublicStats(
  r2: R2Bucket | undefined,
  stats: PublicStats,
  cacheVersion?: string,
  generatedAt: number = Date.now()
): Promise<void> {
  if (!r2) return;

  const payload = JSON.stringify({ data: stats, generatedAt });
  await Promise.all(
    buildListCacheKeys(PUBLIC_STATS_CACHE_KEY, cacheVersion).map((cacheKey) =>
      r2.put(cacheKey, payload, { httpMetadata: { contentType: 'application/json' } })
    )
  );
}

export async function loadPublicStatsLive(db: D1Database): Promise<PublicStats> {
  const result = await db.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public'")
    .first<{ total: number }>();

  return {
    totalSkills: result?.total || 0,
  };
}

async function ensurePredefinedCategoryStats(db: D1Database): Promise<void> {
  if (PREDEFINED_CATEGORY_SLUGS.length === 0) return;

  const placeholders = PREDEFINED_CATEGORY_SLUGS.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM category_public_stats
    WHERE category_slug IN (${placeholders})
  `)
    .bind(...PREDEFINED_CATEGORY_SLUGS)
    .first<CategoryStatsCompletenessRow>();

  if ((Number(result?.count) || 0) >= PREDEFINED_CATEGORY_SLUGS.length) {
    return;
  }

  if (!pendingPredefinedCategoryStatsSync) {
    pendingPredefinedCategoryStatsSync = syncCategoryPublicStats(db, PREDEFINED_CATEGORY_SLUGS)
      .finally(() => {
        pendingPredefinedCategoryStatsSync = null;
      });
  }

  await pendingPredefinedCategoryStatsSync;
}

/**
 * 获取统计数据
 */
export async function getStats(env: DbEnv): Promise<{ totalSkills: number }> {
  const cached = await readCachedPublicStats(env.R2, env.CACHE_VERSION);
  if (cached) return cached;

  if (!env.DB) return { totalSkills: 0 };

  const stats = await loadPublicStatsLive(env.DB);
  void writeCachedPublicStats(env.R2, stats, env.CACHE_VERSION)
    .catch((error) => {
      console.error('Failed to write cached public stats:', error);
    });
  return stats;
}

/**
 * 获取分类统计
 */
export async function getCategoryStats(
  env: DbEnv
): Promise<Record<string, number>> {
  if (!env.DB || PREDEFINED_CATEGORY_SLUGS.length === 0) return {};

  try {
    await ensurePredefinedCategoryStats(env.DB);
    const rows = await readStoredCategoryStats(env.DB, PREDEFINED_CATEGORY_SLUGS);
    return buildCategoryStatsRecord(rows);
  } catch (error) {
    console.error('Failed to load cached category public stats, falling back to live aggregation:', error);
    const aggregateMap = await loadCategoryAggregates(env.DB, PREDEFINED_CATEGORY_SLUGS);
    return buildCategoryStatsRecordFromAggregates(PREDEFINED_CATEGORY_SLUGS, aggregateMap);
  }
}

export async function getDynamicCategories(
  db: D1Database | undefined,
  limit = 50
): Promise<DynamicCategoryStat[]> {
  if (!db || limit <= 0) return [];

  const result = await db.prepare(`
    SELECT
      slug,
      name,
      description,
      type,
      skill_count AS skillCount
    FROM categories
    WHERE type = 'ai-suggested'
      AND skill_count > 0
    ORDER BY skill_count DESC, slug ASC
    LIMIT ?
  `)
    .bind(limit)
    .all<DynamicCategoryStat>();

  return result.results || [];
}

export async function syncCategoryPublicStats(
  db: D1Database,
  categorySlugs: Iterable<string>,
  now = Date.now()
): Promise<void> {
  const normalizedSlugs = normalizeCategorySlugs(categorySlugs);
  if (normalizedSlugs.length === 0) return;

  const aggregateMap = await loadCategoryAggregates(db, normalizedSlugs);
  const columnSupport = await getCategoryPublicStatsColumnSupport(db);
  const includeTopSkillIds = columnSupport.topSkillIdsJson;
  const includeTopRankedSkillIds = columnSupport.topRankedSkillIdsJson;

  for (const slug of normalizedSlugs) {
    const aggregate = aggregateMap.get(slug);
    const count = aggregate?.count ?? 0;
    const maxTs = aggregate?.maxTs ?? null;
    const topSkillIdsJson = includeTopSkillIds && count > 0
      ? JSON.stringify(await loadTopSkillIdsForCategory(db, slug))
      : JSON.stringify([]);
    const topRankedSkillIdsJson = includeTopRankedSkillIds && count > 0
      ? JSON.stringify(await loadTopRankedSkillIdsForCategory(db, slug))
      : JSON.stringify([]);

    if (includeTopSkillIds && includeTopRankedSkillIds) {
      await db.prepare(`
        INSERT INTO category_public_stats (
          category_slug,
          public_skill_count,
          top_skill_ids_json,
          top_ranked_skill_ids_json,
          max_freshness_ts,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(category_slug) DO UPDATE SET
          public_skill_count = excluded.public_skill_count,
          top_skill_ids_json = excluded.top_skill_ids_json,
          top_ranked_skill_ids_json = excluded.top_ranked_skill_ids_json,
          max_freshness_ts = excluded.max_freshness_ts,
          updated_at = excluded.updated_at
      `)
        .bind(slug, count, topSkillIdsJson, topRankedSkillIdsJson, maxTs, now)
        .run();
    } else if (includeTopSkillIds) {
      await db.prepare(`
        INSERT INTO category_public_stats (category_slug, public_skill_count, top_skill_ids_json, max_freshness_ts, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(category_slug) DO UPDATE SET
          public_skill_count = excluded.public_skill_count,
          top_skill_ids_json = excluded.top_skill_ids_json,
          max_freshness_ts = excluded.max_freshness_ts,
          updated_at = excluded.updated_at
      `)
        .bind(slug, count, topSkillIdsJson, maxTs, now)
        .run();
    } else if (includeTopRankedSkillIds) {
      await db.prepare(`
        INSERT INTO category_public_stats (category_slug, public_skill_count, top_ranked_skill_ids_json, max_freshness_ts, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(category_slug) DO UPDATE SET
          public_skill_count = excluded.public_skill_count,
          top_ranked_skill_ids_json = excluded.top_ranked_skill_ids_json,
          max_freshness_ts = excluded.max_freshness_ts,
          updated_at = excluded.updated_at
      `)
        .bind(slug, count, topRankedSkillIdsJson, maxTs, now)
        .run();
    } else {
      await db.prepare(`
        INSERT INTO category_public_stats (category_slug, public_skill_count, max_freshness_ts, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(category_slug) DO UPDATE SET
          public_skill_count = excluded.public_skill_count,
          max_freshness_ts = excluded.max_freshness_ts,
          updated_at = excluded.updated_at
      `)
        .bind(slug, count, maxTs, now)
        .run();
    }

    await db.prepare(`
      UPDATE categories
      SET skill_count = ?, updated_at = ?
      WHERE slug = ?
    `)
      .bind(count, now, slug)
      .run();
  }
}
