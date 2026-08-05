import { describe, expect, it } from 'vitest';
import { isSeoIndexableSkill } from '../src/lib/seo/indexability';
import { buildSeoIndexableSkillWhere } from '../src/lib/server/seo/indexability';

describe('isSeoIndexableSkill', () => {
  it('indexes any public, non-archived skill that has content, regardless of tier or activity', () => {
    expect(isSeoIndexableSkill({
      visibility: 'public',
      tier: 'hot',
      description: 'Useful skill',
    })).toBe(true);

    // Cold tier with no downloads/access is the long-tail case that must stay indexable.
    expect(isSeoIndexableSkill({
      visibility: 'public',
      tier: 'cold',
      description: 'New skill',
    })).toBe(true);

    // Tier is absent on some list payloads; a missing tier must not gate indexation.
    expect(isSeoIndexableSkill({
      visibility: 'public',
      description: 'Listed skill',
    })).toBe(true);
  });

  it('treats a README as content when the description is empty', () => {
    expect(isSeoIndexableSkill({
      visibility: 'public',
      tier: 'cold',
      description: null,
      readme: '# Demo',
    })).toBe(true);

    expect(isSeoIndexableSkill({
      visibility: 'public',
      description: '   ',
      readme: '  # Demo  ',
    })).toBe(true);
  });

  it('excludes non-public, archived, and content-less pages', () => {
    const base = {
      visibility: 'public',
      tier: 'cold',
      description: 'Old skill',
    };

    expect(isSeoIndexableSkill({ ...base, tier: 'archived' })).toBe(false);
    expect(isSeoIndexableSkill({ ...base, visibility: 'private' })).toBe(false);
    expect(isSeoIndexableSkill({ ...base, visibility: 'unlisted' })).toBe(false);
    expect(isSeoIndexableSkill({ ...base, description: ' ', readme: null })).toBe(false);
    expect(isSeoIndexableSkill({ ...base, description: null, readme: '  ' })).toBe(false);
  });
});

describe('buildSeoIndexableSkillWhere', () => {
  it('mirrors the page-level rule: public, non-archived, with a description or README', () => {
    const sql = buildSeoIndexableSkillWhere('skill');

    expect(sql).toContain("skill.visibility = 'public'");
    expect(sql).toContain("COALESCE(skill.tier, 'cold') <> 'archived'");
    expect(sql).toContain("TRIM(COALESCE(skill.description, '')) <> ''");
    expect(sql).toContain("TRIM(COALESCE(skill.readme, '')) <> ''");
  });

  it('no longer gates on tier ranking, activity counters, or an indexing grace window', () => {
    const sql = buildSeoIndexableSkillWhere('skill');

    expect(sql).not.toContain("'hot'");
    expect(sql).not.toContain("'warm'");
    expect(sql).not.toContain('skill.stars');
    expect(sql).not.toContain('skill.download_count_90d');
    expect(sql).not.toContain('skill.access_count_30d');
    expect(sql).not.toContain('skill.indexed_at');
    expect(sql).not.toContain('86400');
  });
});
