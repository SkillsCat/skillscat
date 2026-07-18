import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  getCurrentPublicSkillIds: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  getCached: mocks.getCached,
  invalidateCache: mocks.invalidateCache,
}));

vi.mock('../src/lib/server/skill/visibility', () => ({
  getCurrentPublicSkillIds: mocks.getCurrentPublicSkillIds,
}));

const cachedData = {
  skills: [
    {
      id: 'skill-1',
      name: 'Cached Skill',
      slug: 'acme/cached-skill',
      description: null,
      repoOwner: 'acme',
      repoName: 'cached-skill',
      stars: 1,
      forks: 0,
      trendingScore: 1,
      updatedAt: 1,
      categories: [],
    },
  ],
  total: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCached.mockResolvedValue({ data: cachedData, hit: true });
  mocks.invalidateCache.mockResolvedValue(undefined);
});

describe('public skill data cache', () => {
  it('keeps a cache hit when every skill is still public', async () => {
    mocks.getCurrentPublicSkillIds.mockResolvedValue(new Set(['skill-1']));
    const load = vi.fn(async () => ({ skills: [], total: 0 }));
    const { resolvePublicSkillDataCache } = await import('../src/lib/server/cache/public-skill-data');

    const result = await resolvePublicSkillDataCache({
      db: {} as D1Database,
      cacheKey: 'page:top:v1:1',
      load,
      ttlSeconds: 60,
      getSkills: (data) => data.skills,
    });

    expect(result).toEqual({ data: cachedData, hit: true });
    expect(load).not.toHaveBeenCalled();
    expect(mocks.invalidateCache).not.toHaveBeenCalled();
  });

  it('invalidates and refetches when a cached skill is no longer public', async () => {
    mocks.getCurrentPublicSkillIds.mockResolvedValue(new Set());
    const freshData = { skills: [], total: 0 };
    const load = vi.fn(async () => freshData);
    const { resolvePublicSkillDataCache } = await import('../src/lib/server/cache/public-skill-data');

    const result = await resolvePublicSkillDataCache({
      db: {} as D1Database,
      cacheKey: 'page:top:v1:1',
      load,
      ttlSeconds: 60,
      getSkills: (data) => data.skills,
    });

    expect(result).toEqual({ data: freshData, hit: false });
    expect(mocks.invalidateCache).toHaveBeenCalledWith('page:top:v1:1');
    expect(load).toHaveBeenCalledOnce();
  });
});
