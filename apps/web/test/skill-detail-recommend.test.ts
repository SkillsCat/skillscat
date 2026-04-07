import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCached = vi.fn();
const getAuthContext = vi.fn();
const checkSkillAccess = vi.fn();
const getRecommendedSkills = vi.fn();
const readCachedRecommendSkills = vi.fn();

vi.mock('$lib/server/cache', () => ({
  getCached,
}));

vi.mock('$lib/server/auth/middleware', () => ({
  getAuthContext,
}));

vi.mock('$lib/server/auth/permissions', () => ({
  checkSkillAccess,
}));

vi.mock('$lib/server/db/business/recommend', () => ({
  getRecommendedSkills,
}));

vi.mock('$lib/server/ranking/recommend-cache', () => ({
  readCachedRecommendSkills,
  RECOMMEND_ONLINE_CACHE_TTL_SECONDS: 6 * 60 * 60,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getCached.mockImplementation(async (_cacheKey: string, fetcher: () => Promise<unknown>) => ({
    data: await fetcher(),
    hit: false,
  }));
  getAuthContext.mockResolvedValue({ userId: null, scopes: [] });
  checkSkillAccess.mockResolvedValue(false);
  getRecommendedSkills.mockResolvedValue([]);
  readCachedRecommendSkills.mockResolvedValue({
    recommendSkills: null,
    hit: false,
    algoVersion: 'v1',
  });
});

describe('resolveSkillDetail recommend fallback', () => {
  it('reuses lightweight recommend mode for cool public skills', async () => {
    const detailRow = {
      id: 'skill_1',
      name: 'Demo Skill',
      slug: 'acme/demo-skill',
      description: 'Demo',
      repoOwner: 'acme',
      repoName: 'demo-skill',
      githubUrl: 'https://github.com/acme/demo-skill',
      skillPath: 'SKILL.md',
      stars: 10,
      forks: 1,
      trendingScore: 5,
      updatedAt: Date.now(),
      readme: '# Demo',
      fileStructure: null,
      lastCommitAt: null,
      createdAt: Date.now(),
      indexedAt: Date.now(),
      sourceType: 'github',
      visibility: 'public',
      tier: 'cool',
      categories: 'automation',
      authorUsername: 'acme',
      authorDisplayName: 'Acme',
      authorAvatar: null,
      authorBio: null,
      authorSkillsCount: 1,
      authorTotalStars: 10,
    };

    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => detailRow),
        })),
      })),
    };

    const { resolveSkillDetail } = await import('../src/lib/server/skill/detail');
    const result = await resolveSkillDetail({
      db: db as never,
      r2: undefined,
      request: new Request('https://skills.cat/api/skills/acme/demo-skill'),
      locals: {},
      waitUntil: undefined,
      recommendAlgoVersion: 'v1',
    }, 'acme/demo-skill');

    expect(result.status).toBe(200);
    expect(getRecommendedSkills).toHaveBeenCalledTimes(1);
    expect(getRecommendedSkills.mock.calls[0]?.[2]).toEqual([]);
    expect(getRecommendedSkills.mock.calls[0]?.[7]).toEqual([]);
    expect(getCached.mock.calls.map((call) => call[0])).toContain('recommend:skill_1:lightweight');
  });
});
