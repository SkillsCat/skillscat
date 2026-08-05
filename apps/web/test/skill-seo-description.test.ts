import { describe, expect, it } from 'vitest';
import type { SkillDetail } from '../src/lib/types';
import { buildSkillSeoPayload } from '../src/lib/seo/skill-seo';

function createSkill(overrides: Partial<SkillDetail> = {}): SkillDetail {
  return {
    id: 'skill_1',
    name: 'Demo Skill',
    slug: 'acme/demo-skill',
    description: null,
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

const LONG_DESCRIPTION =
  'Generate production-ready docker compose files for local development stacks with sane defaults.';

const SUMMARY =
  'This skill scaffolds docker compose configurations. It solves slow local environment setup. Use it when bootstrapping new services.';

describe('buildSkillSeoPayload description', () => {
  it('keeps a strong description unchanged', () => {
    const payload = buildSkillSeoPayload(createSkill({
      description: LONG_DESCRIPTION,
      summary: SUMMARY,
    }));

    expect(payload.description).toBe(LONG_DESCRIPTION);
  });

  it('pads a thin description with the AI summary', () => {
    const payload = buildSkillSeoPayload(createSkill({
      description: 'Docker compose helper.',
      summary: SUMMARY,
    }));

    expect(payload.description).toBe(`Docker compose helper. ${SUMMARY}`);
  });

  it('uses the summary alone when the description is missing', () => {
    const payload = buildSkillSeoPayload(createSkill({
      summary: SUMMARY,
    }));

    expect(payload.description).toBe(SUMMARY);
  });

  it('truncates overlong combined text to 160 chars', () => {
    const longSummary = 'word '.repeat(80).trim();
    const payload = buildSkillSeoPayload(createSkill({
      description: 'Docker compose helper.',
      summary: longSummary,
    }));

    expect(payload.description.length).toBeLessThanOrEqual(160);
    expect(payload.description.endsWith('…')).toBe(true);
  });

  it('falls back to the generic line when neither description nor summary exists', () => {
    const payload = buildSkillSeoPayload(createSkill());

    expect(payload.description).toBe('Discover Demo Skill on SkillsCat.');
  });

  it('ignores a blank summary', () => {
    const payload = buildSkillSeoPayload(createSkill({
      summary: '   ',
    }));

    expect(payload.description).toBe('Discover Demo Skill on SkillsCat.');
  });
});
