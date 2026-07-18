import { SEO_INDEXING_GRACE_PERIOD_DAYS } from '$lib/seo/indexability';

/** SQL counterpart of `isSeoIndexableSkill`; keep sitemap and aggregate counts aligned. */
export function buildSeoIndexableSkillWhere(alias = 's'): string {
  return `
    ${alias}.visibility = 'public'
    AND TRIM(COALESCE(${alias}.description, '')) <> ''
    AND COALESCE(${alias}.tier, 'cold') <> 'archived'
    AND (
      ${alias}.tier IN ('hot', 'warm')
      OR COALESCE(${alias}.download_count_90d, 0) > 0
      OR COALESCE(${alias}.access_count_30d, 0) > 0
      OR ${alias}.indexed_at >= (unixepoch('now') - ${SEO_INDEXING_GRACE_PERIOD_DAYS} * 86400) * 1000
    )
  `;
}
