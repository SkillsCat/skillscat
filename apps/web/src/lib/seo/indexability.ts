export interface SeoIndexableSkillInput {
  visibility?: string | null;
  tier?: string | null;
  description?: string | null;
  readme?: string | null;
}

/**
 * A skill page is indexable when it is publicly visible, not archived, and
 * has any real content (a description or a README). Tier, stars, and access
 * counts only affect ranking/refresh cadence — they must not gate indexation,
 * otherwise the long tail of cold-tier skills flips to noindex and drops out
 * of the index (see the post-99d0ed5 indexing collapse).
 */
export function isSeoIndexableSkill(skill: SeoIndexableSkillInput): boolean {
  if (skill.visibility !== 'public') return false;
  if (skill.tier === 'archived') return false;
  return Boolean(skill.description?.trim()) || Boolean(skill.readme?.trim());
}
