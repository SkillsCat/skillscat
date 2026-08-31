import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOME_CRITICAL_CACHE_KEY,
  HOME_RECENT_CACHE_KEY,
  HOME_TOP_CACHE_KEY,
  PUBLIC_SKILLS_STATS_CACHE_KEY,
} from '$lib/server/cache/keys';

const getCached = vi.fn();
const invalidateCache = vi.fn();
const setPublicPageCache = vi.fn();
const schedulePublicSkillVisibilityRecheck = vi.fn();
const getTrendingSkills = vi.fn();
const getRecentSkills = vi.fn();
const getTopSkills = vi.fn();
const getStats = vi.fn();

vi.mock('$lib/server/cache', () => ({
  getCached,
  invalidateCache,
}));

vi.mock('$lib/server/skill/visibility', () => ({
  schedulePublicSkillVisibilityRecheck,
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

    expect(result.recent).toEqual([{ slug: 'demo/recent' }]);
    expect(result.top).toEqual([{ slug: 'demo/top' }]);

    expect(getCached).toHaveBeenCalledWith(
      HOME_CRITICAL_CACHE_KEY,
      expect.any(Function),
      30,
      { waitUntil: undefined }
    );
    expect(getCached).toHaveBeenCalledWith(
      HOME_RECENT_CACHE_KEY,
      expect.any(Function),
      30,
      { waitUntil: undefined }
    );
    expect(getCached).toHaveBeenCalledWith(
      HOME_TOP_CACHE_KEY,
      expect.any(Function),
      30,
      { waitUntil: undefined }
    );
    expect(getCached).toHaveBeenCalledWith(
      PUBLIC_SKILLS_STATS_CACHE_KEY,
      expect.any(Function),
      120
    );
  });

  it('serves cached lists immediately and schedules an async visibility recheck', async () => {
    const criticalPayload = { stats: { publicSkills: 5 }, trending: [{ id: 'trending-1' }] };
    const recentPayload = [{ id: 'recent-1' }];
    const topPayload = [{ id: 'top-1' }];
    getCached.mockImplementation(async (cacheKey: string) => {
      if (cacheKey === HOME_CRITICAL_CACHE_KEY) return { data: criticalPayload, hit: true };
      if (cacheKey === HOME_RECENT_CACHE_KEY) return { data: recentPayload, hit: true };
      if (cacheKey === HOME_TOP_CACHE_KEY) return { data: topPayload, hit: true };
      throw new Error(`unexpected cache key ${cacheKey}`);
    });
    const waitUntil = vi.fn();
    const db = {} as D1Database;

    const { load } = await import('../src/routes/+page.server');
    const result = await load({
      platform: {
        env: { DB: db, R2: undefined, CACHE_VERSION: 'test' },
        context: { waitUntil },
      },
      setHeaders: vi.fn(),
      locals: { user: null },
      request: new Request('https://skills.cat/'),
    } as never);

    // Cached payloads are returned as-is without refetching.
    expect(result.trending).toEqual(criticalPayload.trending);
    expect(result.stats).toEqual(criticalPayload.stats);
    expect(result.recent).toEqual(recentPayload);
    expect(result.top).toEqual(topPayload);
    expect(getTrendingSkills).not.toHaveBeenCalled();
    expect(getRecentSkills).not.toHaveBeenCalled();
    expect(getTopSkills).not.toHaveBeenCalled();

    // The visibility recheck is delegated to the async helper.
    expect(schedulePublicSkillVisibilityRecheck).toHaveBeenCalledTimes(1);
    const recheckInput = schedulePublicSkillVisibilityRecheck.mock.calls[0][0];
    expect(recheckInput.db).toBe(db);
    expect(typeof recheckInput.waitUntil).toBe('function');
    expect(recheckInput.entries.map((entry: { ids: string[] }) => entry.ids)).toEqual([
      ['trending-1'],
      ['recent-1'],
      ['top-1'],
    ]);
  });

  it('only rechecks lists served from cache and wires invalidation per key', async () => {
    const criticalPayload = { stats: { publicSkills: 5 }, trending: [{ id: 'trending-1' }] };
    const topPayload = [{ id: 'top-1' }];
    getCached.mockImplementation(async (cacheKey: string, fetcher: () => Promise<unknown>) => {
      if (cacheKey === HOME_CRITICAL_CACHE_KEY) return { data: criticalPayload, hit: true };
      if (cacheKey === HOME_TOP_CACHE_KEY) return { data: topPayload, hit: true };
      return { data: await fetcher(), hit: false };
    });

    const { load } = await import('../src/routes/+page.server');
    await load({
      platform: {
        env: { DB: {} as D1Database, R2: undefined, CACHE_VERSION: 'test' },
        context: { waitUntil: vi.fn() },
      },
      setHeaders: vi.fn(),
      locals: { user: null },
      request: new Request('https://skills.cat/'),
    } as never);

    expect(schedulePublicSkillVisibilityRecheck).toHaveBeenCalledTimes(1);
    const recheckInput = schedulePublicSkillVisibilityRecheck.mock.calls[0][0];
    expect(recheckInput.entries).toHaveLength(2);

    await recheckInput.entries[0].invalidate();
    await recheckInput.entries[1].invalidate();
    expect(invalidateCache).toHaveBeenCalledWith(HOME_CRITICAL_CACHE_KEY);
    expect(invalidateCache).toHaveBeenCalledWith(HOME_TOP_CACHE_KEY);
    expect(invalidateCache).not.toHaveBeenCalledWith(HOME_RECENT_CACHE_KEY);
  });

  it('skips the recheck entirely when D1 is unavailable', async () => {
    const { load } = await import('../src/routes/+page.server');
    await load({
      platform: {
        env: { DB: undefined, R2: undefined, CACHE_VERSION: 'test' },
      },
      setHeaders: vi.fn(),
      locals: { user: null },
      request: new Request('https://skills.cat/'),
    } as never);

    expect(schedulePublicSkillVisibilityRecheck).not.toHaveBeenCalled();
  });
});
