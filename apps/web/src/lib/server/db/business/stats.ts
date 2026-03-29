import { PREDEFINED_CATEGORY_SLUGS } from '$lib/server/db/shared/constants';
import type { DbEnv } from '$lib/server/db/shared/types';

interface CategoryCountRow {
  category_slug: string;
  count: number;
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

  const categoryPlaceholders = PREDEFINED_CATEGORY_SLUGS.map(() => '?').join(',');

  const result = await env.DB.prepare(`
    SELECT sc.category_slug, COUNT(*) as count
    FROM skill_categories sc
    CROSS JOIN skills s
    WHERE s.id = sc.skill_id
      AND s.visibility = 'public'
      AND sc.category_slug IN (${categoryPlaceholders})
    GROUP BY sc.category_slug
  `)
    .bind(...PREDEFINED_CATEGORY_SLUGS)
    .all<CategoryCountRow>();

  const stats: Record<string, number> = {};
  for (const row of result.results) {
    stats[row.category_slug] = row.count;
  }

  return stats;
}
