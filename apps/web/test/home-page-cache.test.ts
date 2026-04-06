import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOME_CRITICAL_CACHE_KEY,
  HOME_RECENT_CACHE_KEY,
  HOME_TOP_CACHE_KEY,
  PUBLIC_SKILLS_STATS_CACHE_KEY,
} from '$lib/server/cache/keys';

const getCached = vi.fn();
const setPublicPageCache = vi.fn();
const getTrendingSkills = vi.fn();
const getRecentSkills = vi.fn();
const getTopSkills = vi.fn();
const getStats = vi.fn();

vi.mock('$lib/server/cache', () => ({
  getCached,
}));

vi.mock('$lib/server/cache/page', () => ({
  setPublicPageCache,
}));

vi.mock('$lib/server/db/business/lists', () => ({
  getTrendingSkills,
  getRecentSkills,
  getTopSkills,
}));

vi.mock('$lib/server/db/business/stats', () => ({
  getStats,
}));

describe('home page caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCached.mockImplementation(async (_cacheKey: string, fetcher: () => Promise<unknown>) => ({
      data: await fetcher(),
      hit: false,
    }));
    getTrendingSkills.mockResolvedValue([{ slug: 'demo/trending' }]);
    getRecentSkills.mockResolvedValue([{ slug: 'demo/recent' }]);
    getTopSkills.mockResolvedValue([{ slug: 'demo/top' }]);
    getStats.mockResolvedValue({ publicSkills: 1 });
  });

  it('caches critical, recent, and top homepage payloads separately', async () => {
    const { load } = await import('../src/routes/+page.server');

    const result = await load({
      platform: {
        env: {
          DB: undefined,
          R2: undefined,
          CACHE_VERSION: 'test',
        },
      },
      setHeaders: vi.fn(),
      locals: {
        user: null,
      },
      request: new Request('https://skills.cat/'),
    } as never);

    await expect(result.recent).resolves.toEqual([{ slug: 'demo/recent' }]);
    await expect(result.top).resolves.toEqual([{ slug: 'demo/top' }]);

    expect(getCached).toHaveBeenCalledWith(
      HOME_CRITICAL_CACHE_KEY,
      expect.any(Function),
      30
    );
    expect(getCached).toHaveBeenCalledWith(
      HOME_RECENT_CACHE_KEY,
      expect.any(Function),
      30
    );
    expect(getCached).toHaveBeenCalledWith(
      HOME_TOP_CACHE_KEY,
      expect.any(Function),
      30
    );
    expect(getCached).toHaveBeenCalledWith(
      PUBLIC_SKILLS_STATS_CACHE_KEY,
      expect.any(Function),
      120
    );
  });
});
