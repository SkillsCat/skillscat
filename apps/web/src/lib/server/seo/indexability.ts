/** SQL counterpart of `isSeoIndexableSkill`; keep sitemap and aggregate counts aligned. */
export function buildSeoIndexableSkillWhere(alias = 's'): string {
  return `
    ${alias}.visibility = 'public'
    AND COALESCE(${alias}.tier, 'cold') <> 'archived'
    AND (
      TRIM(COALESCE(${alias}.description, '')) <> ''
      OR TRIM(COALESCE(${alias}.readme, '')) <> ''
    )
  `;
}
