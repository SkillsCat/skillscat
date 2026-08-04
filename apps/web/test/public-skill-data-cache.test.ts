import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  getCached: mocks.getCached,
  invalidateCache: mocks.invalidateCache,
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

function createVisibilityDb(publicIds: string[], options?: { fail?: boolean; defer?: boolean }) {
  const queries: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return {
        bind(...params: unknown[]) {
          return {
            async all() {
              if (options?.fail) {
                throw new Error('D1 unavailable');
              }
              if (options?.defer) {
                await gate;
              }
              const allowed = new Set(publicIds);
              return {
                results: params
                  .filter((param) => allowed.has(String(param)))
                  .map((id) => ({ id })),
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, queries, release };
}

function createWaitUntilCapture() {
  const tasks: Promise<unknown>[] = [];
  return {
    tasks,
    waitUntil: (promise: Promise<unknown>) => {
      tasks.push(promise);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.getCached.mockResolvedValue({ data: cachedData, hit: true });
  mocks.invalidateCache.mockResolvedValue(undefined);
});

describe('public skill data cache', () => {
  it('serves a cache hit without waiting for the D1 visibility recheck', async () => {
    const { db, queries, release } = createVisibilityDb(['skill-1'], { defer: true });
    const { tasks, waitUntil } = createWaitUntilCapture();
    const load = vi.fn(async () => ({ skills: [], total: 0 }));
    const { resolvePublicSkillDataCache } = await import('../src/lib/server/cache/public-skill-data');

    // The D1 recheck query stays blocked; the response must not wait for it.
    const result = await resolvePublicSkillDataCache({
      db,
      cacheKey: 'page:top:v1:1',
      load,
      ttlSeconds: 60,
      getSkills: (data) => data.skills,
      waitUntil,
    });

    expect(result).toEqual({ data: cachedData, hit: true });
    expect(load).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    expect(mocks.invalidateCache).not.toHaveBeenCalled();

    release();
    await Promise.all(tasks);
    expect(queries.some((sql) => sql.includes("visibility = 'public'"))).toBe(true);
    expect(mocks.invalidateCache).not.toHaveBeenCalled();
  });

  it('serves the cached payload and invalidates the key when the async recheck finds a stale skill', async () => {
    const { db } = createVisibilityDb([]);
    const { tasks, waitUntil } = createWaitUntilCapture();
    const load = vi.fn(async () => ({ skills: [], total: 0 }));
    const { resolvePublicSkillDataCache } = await import('../src/lib/server/cache/public-skill-data');

    const result = await resolvePublicSkillDataCache({
      db,
      cacheKey: 'page:top:v1:1',
      load,
      ttlSeconds: 60,
      getSkills: (data) => data.skills,
      waitUntil,
    });

    expect(result).toEqual({ data: cachedData, hit: true });
    expect(load).not.toHaveBeenCalled();

    await Promise.all(tasks);
    expect(mocks.invalidateCache).toHaveBeenCalledWith('page:top:v1:1');
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the response intact when the async recheck fails', async () => {
    const { db } = createVisibilityDb([], { fail: true });
    const { tasks, waitUntil } = createWaitUntilCapture();
    const load = vi.fn(async () => ({ skills: [], total: 0 }));
    const { resolvePublicSkillDataCache } = await import('../src/lib/server/cache/public-skill-data');

    const result = await resolvePublicSkillDataCache({
      db,
      cacheKey: 'page:top:v1:1',
      load,
      ttlSeconds: 60,
      getSkills: (data) => data.skills,
      waitUntil,
    });

    expect(result).toEqual({ data: cachedData, hit: true });
    expect(tasks).toHaveLength(1);
    await expect(Promise.all(tasks)).resolves.toBeDefined();
    expect(mocks.invalidateCache).not.toHaveBeenCalled();
  });

  it('does not schedule a recheck on a cache miss', async () => {
    mocks.getCached.mockImplementation(async (_cacheKey: string, fetcher: () => Promise<unknown>) => ({
      data: await fetcher(),
      hit: false,
    }));
    const { db, queries } = createVisibilityDb(['skill-1']);
    const { tasks, waitUntil } = createWaitUntilCapture();
    const load = vi.fn(async () => cachedData);
    const { resolvePublicSkillDataCache } = await import('../src/lib/server/cache/public-skill-data');

    const result = await resolvePublicSkillDataCache({
      db,
      cacheKey: 'page:top:v1:1',
      load,
      ttlSeconds: 60,
      getSkills: (data) => data.skills,
      waitUntil,
    });

    expect(result).toEqual({ data: cachedData, hit: false });
    expect(load).toHaveBeenCalledOnce();
    expect(tasks).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });
});
