import { PREDEFINED_CATEGORY_SLUGS } from '$lib/server/db/shared/constants';
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

let pendingPredefinedCategoryStatsSync: Promise<void> | null = null;
const CATEGORY_PUBLIC_TOP_SKILL_IDS_LIMIT = 96;
let supportsCategoryTopSkillIdsColumn: boolean | null = null;

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
    JOIN skills s
      ON s.id = sc.skill_id
     AND s.visibility = 'public'
    WHERE sc.category_slug = ?
    ORDER BY s.trending_score DESC
    LIMIT ?
  `)
    .bind(categorySlug, limit)
    .all<CategoryTopSkillRow>();

  return (result.results || [])
    .map((row) => row.skillId)
    .filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0);
}

async function hasCategoryTopSkillIdsColumn(db: D1Database): Promise<boolean> {
  if (supportsCategoryTopSkillIdsColumn !== null) {
    return supportsCategoryTopSkillIdsColumn;
  }

  try {
    const result = await db.prepare(`PRAGMA table_info(category_public_stats)`).all<TableInfoRow>();
    supportsCategoryTopSkillIdsColumn = (result.results || []).some((row) => row.name === 'top_skill_ids_json');
  } catch {
    supportsCategoryTopSkillIdsColumn = false;
  }

  return supportsCategoryTopSkillIdsColumn;
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
  if (!env.DB) return { totalSkills: 0 };

  const result = await env.DB.prepare("SELECT COUNT(*) as total FROM skills WHERE visibility = 'public'")
    .first<{ total: number }>();

  return {
    totalSkills: result?.total || 0,
  };
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
  const includeTopSkillIds = await hasCategoryTopSkillIdsColumn(db);

  for (const slug of normalizedSlugs) {
    const aggregate = aggregateMap.get(slug);
    const count = aggregate?.count ?? 0;
    const maxTs = aggregate?.maxTs ?? null;
    const topSkillIdsJson = includeTopSkillIds && count > 0
      ? JSON.stringify(await loadTopSkillIdsForCategory(db, slug))
      : JSON.stringify([]);

    if (includeTopSkillIds) {
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
