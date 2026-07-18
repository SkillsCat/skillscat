import { describe, expect, it } from 'vitest';
import {
  SEO_INDEXING_GRACE_PERIOD_MS,
  isSeoIndexableSkill,
} from '../src/lib/seo/indexability';
import { buildSeoIndexableSkillWhere } from '../src/lib/server/seo/indexability';

describe('isSeoIndexableSkill', () => {
  const now = Date.parse('2026-07-18T00:00:00.000Z');

  it('keeps active and newly discovered public skills indexable', () => {
    expect(isSeoIndexableSkill({
      visibility: 'public',
      tier: 'hot',
      description: 'Useful skill',
      indexedAt: now - SEO_INDEXING_GRACE_PERIOD_MS * 2,
    }, now)).toBe(true);

    expect(isSeoIndexableSkill({
      visibility: 'public',
      tier: 'cold',
      description: 'New skill',
      indexedAt: now - 1_000,
    }, now)).toBe(true);
  });

  it('excludes stale low-signal, archived, and incomplete pages', () => {
    const stale = {
      visibility: 'public',
      tier: 'cold',
      description: 'Old skill',
      indexedAt: now - SEO_INDEXING_GRACE_PERIOD_MS * 2,
    };

    expect(isSeoIndexableSkill(stale, now)).toBe(false);
    expect(isSeoIndexableSkill({ ...stale, downloadCount90d: 1 }, now)).toBe(true);
    expect(isSeoIndexableSkill({ ...stale, tier: 'warm' }, now)).toBe(true);
    expect(isSeoIndexableSkill({ ...stale, tier: 'archived' }, now)).toBe(false);
    expect(isSeoIndexableSkill({ ...stale, description: ' ' }, now)).toBe(false);
    expect(isSeoIndexableSkill({ ...stale, visibility: 'private' }, now)).toBe(false);
  });
});

describe('buildSeoIndexableSkillWhere', () => {
  it('keeps the SQL predicate aligned with the page-level quality signals', () => {
    const sql = buildSeoIndexableSkillWhere('skill');

    expect(sql).toContain("skill.visibility = 'public'");
    expect(sql).toContain("COALESCE(skill.tier, 'cold') <> 'archived'");
    expect(sql).toContain('skill.download_count_90d');
    expect(sql).toContain('skill.access_count_30d');
    expect(sql).not.toContain('skill.stars');
    expect(sql).toContain('90 * 86400');
  });
});
