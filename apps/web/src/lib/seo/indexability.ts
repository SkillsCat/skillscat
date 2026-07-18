export const SEO_INDEXING_GRACE_PERIOD_DAYS = 90;
export const SEO_INDEXING_GRACE_PERIOD_MS = SEO_INDEXING_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export interface SeoIndexableSkillInput {
  visibility?: string | null;
  tier?: string | null;
  description?: string | null;
  indexedAt?: number | null;
  downloadCount90d?: number | null;
  accessCount30d?: number | null;
}

/**
 * Keep the index focused on pages that have either editorial/ranking evidence
 * or are still within the discovery window. New skills remain discoverable
 * while long-lived, inactive, low-signal pages stop diluting the index.
 */
export function isSeoIndexableSkill(
  skill: SeoIndexableSkillInput,
  now = Date.now()
): boolean {
  if (skill.visibility !== 'public') return false;
  if (!skill.description?.trim()) return false;
  if (skill.tier === 'archived') return false;

  const isFresh = Number.isFinite(skill.indexedAt)
    && Number(skill.indexedAt) >= now - SEO_INDEXING_GRACE_PERIOD_MS;
  const hasActivity = Number(skill.downloadCount90d || 0) > 0
    || Number(skill.accessCount30d || 0) > 0;

  return skill.tier === 'hot' || skill.tier === 'warm' || isFresh || hasActivity;
}
