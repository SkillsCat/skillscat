import { describe, expect, it } from 'vitest';
import type { SkillDetail } from '../src/lib/types';
import { buildSkillSeoKeywords, buildSkillSeoPayload } from '../src/lib/seo/skill-seo';

function createSkill(overrides: Partial<SkillDetail> = {}): SkillDetail {
  return {
    id: 'skill_1',
    name: 'Demo Skill',
    slug: 'acme/demo-skill',
    description: 'Generate docker compose files for local development stacks.',
    repoOwner: 'acme',
    repoName: 'demo-skill',
    stars: 10,
    forks: 1,
    trendingScore: 5,
    updatedAt: Date.now(),
    categories: [],
    classificationMethod: 'ai',
    githubUrl: 'https://github.com/acme/demo-skill',
    skillPath: 'SKILL.md',
    readme: null,
    fileStructure: null,
    lastCommitAt: null,
    createdAt: Date.now(),
    indexedAt: Date.now(),
    visibility: 'public',
    sourceType: 'github',
    ...overrides,
  };
}

describe('buildSkillSeoKeywords', () => {
  it('keeps only the skill name and real category names', () => {
    const keywords = buildSkillSeoKeywords(createSkill({
      categories: ['code-generation', 'debugging'],
    }));

    expect(keywords).toEqual(['Demo Skill', 'Code Gen', 'Debugging']);
  });

  it('falls back to just the skill name when there are no categories', () => {
    expect(buildSkillSeoKeywords(createSkill())).toEqual(['Demo Skill']);
  });

  it('never emits programmatic permutations', () => {
    const keywords = buildSkillSeoKeywords(createSkill({
      categories: ['code-generation'],
    }));

    expect(keywords.length).toBeLessThanOrEqual(5);
    for (const keyword of keywords) {
      expect(keyword).not.toMatch(/automation skill$/i);
      expect(keyword).not.toMatch(/ai agent skill$/i);
      expect(keyword).not.toMatch(/workflow$/i);
    }
    expect(keywords).not.toContain('acme/demo-skill');
    expect(keywords).not.toContain('skillscat');
  });

  it('dedupes a category name that matches the skill name', () => {
    const keywords = buildSkillSeoKeywords(createSkill({
      name: 'Debugging',
      categories: ['debugging'],
    }));

    expect(keywords).toEqual(['Debugging']);
  });
});

describe('buildSkillSeoPayload', () => {
  it('uses converged keywords and real category names as article tags', () => {
    const payload = buildSkillSeoPayload(createSkill({
      categories: ['code-generation', 'debugging'],
    }));

    expect(payload.keywords).toEqual(['Demo Skill', 'Code Gen', 'Debugging']);
    expect(payload.articleTags).toEqual(['Code Gen', 'Debugging']);
    expect(payload.section).toBe('Code Gen');
    expect(payload.title).toBe('Demo Skill | Code Gen AI Agent Skill | SkillsCat');
  });

  it('omits article tags and section when the skill has no categories', () => {
    const payload = buildSkillSeoPayload(createSkill());

    expect(payload.keywords).toEqual(['Demo Skill']);
    expect(payload.articleTags).toEqual([]);
    expect(payload.section).toBeUndefined();
  });
});
