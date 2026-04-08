import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCached = vi.fn();
const invalidateCache = vi.fn();
const getAuthContext = vi.fn();
const requireScope = vi.fn();
const checkSkillAccess = vi.fn();
const getRecommendedSkills = vi.fn();
const getLightweightRecommendedSkills = vi.fn();
const isOpenClawUserAgent = vi.fn();
const readCachedRecommendSkills = vi.fn();
const shouldRefreshPrecomputedRecommend = vi.fn();
const markRecommendDirty = vi.fn();
const markRecommendFallbackServed = vi.fn();
const normalizeRecommendAlgoVersion = vi.fn();
const upsertRecommendStateFailure = vi.fn();
const upsertRecommendStateSuccess = vi.fn();
const writeRecommendPrecomputedPayload = vi.fn();

vi.mock('$lib/server/cache', () => ({
  getCached,
  invalidateCache,
}));

vi.mock('$lib/server/auth/middleware', () => ({
  getAuthContext,
  requireScope,
}));

vi.mock('$lib/server/auth/permissions', () => ({
  checkSkillAccess,
}));

vi.mock('$lib/server/db/business/recommend', () => ({
  getRecommendedSkills,
  getLightweightRecommendedSkills,
}));

vi.mock('$lib/server/openclaw/agent-markdown', () => ({
  isOpenClawUserAgent,
}));

vi.mock('$lib/server/ranking/recommend-cache', () => ({
  buildRecommendPrecomputedCacheKey: (skillId: string, algoVersion: string) => `recommend:${skillId}:${algoVersion}`,
  readCachedRecommendSkills,
  RECOMMEND_ONLINE_CACHE_TTL_SECONDS: 6 * 60 * 60,
  shouldRefreshPrecomputedRecommend,
}));

vi.mock('$lib/server/ranking/recommend-precompute', () => ({
  markRecommendDirty,
  markRecommendFallbackServed,
  normalizeRecommendAlgoVersion,
  upsertRecommendStateFailure,
  upsertRecommendStateSuccess,
  writeRecommendPrecomputedPayload,
}));

function createDb(firstResults: unknown[]) {
  const queue = [...firstResults];
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => queue.shift() ?? null),
      })),
    })),
  };
}

function createRequest(
  input: {
    userAgent?: string;
    secChUa?: string;
    cf?: unknown;
  } = {}
): Request {
  const headers = new Headers();
  if (input.userAgent) {
    headers.set('user-agent', input.userAgent);
  }
  if (input.secChUa) {
    headers.set('sec-ch-ua', input.secChUa);
  }

  const request = new Request('https://skills.cat/api/skills/acme/demo-skill/recommend', {
    headers,
  });

  if (input.cf) {
    Object.defineProperty(request, 'cf', {
      value: input.cf,
      configurable: true,
    });
  }

  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCached.mockImplementation(async (_cacheKey: string, fetcher: () => Promise<unknown>) => ({
    data: await fetcher(),
    hit: false,
  }));
  getAuthContext.mockResolvedValue({ userId: null, scopes: [] });
  checkSkillAccess.mockResolvedValue(false);
  getRecommendedSkills.mockResolvedValue([]);
  getLightweightRecommendedSkills.mockResolvedValue([]);
  isOpenClawUserAgent.mockReturnValue(false);
  readCachedRecommendSkills.mockResolvedValue({
    recommendSkills: null,
    hit: false,
    algoVersion: 'v1',
  });
  shouldRefreshPrecomputedRecommend.mockReturnValue(false);
  markRecommendDirty.mockResolvedValue(undefined);
  markRecommendFallbackServed.mockResolvedValue(undefined);
  normalizeRecommendAlgoVersion.mockReturnValue('v1');
  upsertRecommendStateFailure.mockResolvedValue(undefined);
  upsertRecommendStateSuccess.mockResolvedValue(undefined);
  writeRecommendPrecomputedPayload.mockResolvedValue(undefined);
  invalidateCache.mockResolvedValue(undefined);
});

describe('recommend route crawler fallback policy', () => {
  it('skips realtime fallback for verified bots on cold skills without precompute', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'cold',
        recommendDirty: null,
        recommendNextUpdateAt: null,
        recommendPrecomputedAt: null,
        recommendAlgoVersion: null,
      },
    ]);
    const waitUntil = vi.fn();
    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      cf: {
        botManagement: {
          verifiedBot: true,
        },
      },
    });

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db }, context: { waitUntil } },
      request,
      locals: {},
      url: new URL(request.url),
    } as never);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        recommendSkills: [],
      },
    });
    expect(getRecommendedSkills).not.toHaveBeenCalled();
    expect(getCached).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
    expect(response.headers.get('vary')).toBe('User-Agent');
  });

  it('does not schedule stale refresh for crawler requests on cold skills', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'cold',
        recommendDirty: 1,
        recommendNextUpdateAt: Date.now() - 1_000,
        recommendPrecomputedAt: Date.now() - 86_400_000,
        recommendAlgoVersion: 'v1',
      },
    ]);
    const waitUntil = vi.fn();
    readCachedRecommendSkills.mockResolvedValue({
      recommendSkills: [
        {
          id: 'rec_1',
          name: 'Cached',
          slug: 'acme/cached',
          description: 'cached',
          repoOwner: 'acme',
          repoName: 'cached',
          stars: 1,
          forks: 0,
          trendingScore: 1,
          updatedAt: Date.now(),
          categories: [],
        },
      ],
      hit: true,
      algoVersion: 'v1',
    });
    shouldRefreshPrecomputedRecommend.mockReturnValue(true);
    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      secChUa: '"Chromium";v="126", "HeadlessChrome";v="126"',
    });

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db }, context: { waitUntil } },
      request,
      locals: {},
      url: new URL(request.url),
    } as never);

    const payload = await response.json();
    expect(payload.data.recommendSkills).toHaveLength(1);
    expect(getRecommendedSkills).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('bypasses empty precomputed payloads for human traffic and falls back online', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'cool',
        recommendDirty: 0,
        recommendNextUpdateAt: null,
        recommendPrecomputedAt: Date.now(),
        recommendAlgoVersion: 'v1',
        recommendLastFallbackAt: null,
      },
    ]);
    readCachedRecommendSkills.mockResolvedValue({
      recommendSkills: [],
      hit: true,
      algoVersion: 'v1',
    });
    getLightweightRecommendedSkills.mockResolvedValue([
      {
        id: 'rec_1',
        name: 'Fallback Related',
        slug: 'acme/fallback-related',
        description: 'fallback',
        repoOwner: 'acme',
        repoName: 'fallback-related',
        stars: 3,
        forks: 0,
        trendingScore: 4,
        updatedAt: Date.now(),
        categories: [],
      },
    ]);

    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db } },
      request,
      locals: {},
      url: new URL(request.url),
    } as never);

    const payload = await response.json();
    expect(payload.data.recommendSkills).toHaveLength(1);
    expect(getLightweightRecommendedSkills).toHaveBeenCalledTimes(1);
    expect(getRecommendedSkills).not.toHaveBeenCalled();
  });

  it('keeps hot skills eligible for online fallback even for verified bots', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'hot',
        recommendDirty: null,
        recommendNextUpdateAt: null,
        recommendPrecomputedAt: null,
        recommendAlgoVersion: null,
      },
      {
        categoriesJson: '["automation"]',
        tagsJson: '["agent"]',
      },
    ]);
    const waitUntil = vi.fn();
    getRecommendedSkills.mockResolvedValue([
      {
        id: 'rec_1',
        name: 'Hot Related',
        slug: 'acme/hot-related',
        description: 'hot',
        repoOwner: 'acme',
        repoName: 'hot-related',
        stars: 10,
        forks: 1,
        trendingScore: 8,
        updatedAt: Date.now(),
        categories: [],
      },
    ]);
    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      cf: {
        botManagement: {
          verifiedBot: true,
        },
      },
    });

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db }, context: { waitUntil } },
      request,
      locals: {},
      url: new URL(request.url),
    } as never);

    const payload = await response.json();
    expect(payload.data.recommendSkills).toHaveLength(1);
    expect(getRecommendedSkills).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('uses lightweight realtime fallback for cool public skills and only marks background refresh', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'cool',
        recommendDirty: null,
        recommendNextUpdateAt: null,
        recommendPrecomputedAt: null,
        recommendAlgoVersion: null,
        recommendLastFallbackAt: null,
      },
    ]);
    getLightweightRecommendedSkills.mockResolvedValue([
      {
        id: 'rec_1',
        name: 'Fallback Related',
        slug: 'acme/fallback-related',
        description: 'fallback',
        repoOwner: 'acme',
        repoName: 'fallback-related',
        stars: 3,
        forks: 0,
        trendingScore: 4,
        updatedAt: Date.now(),
        categories: [],
      },
    ]);
    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db } },
      request,
      locals: {},
      url: new URL(request.url),
    } as never);

    const payload = await response.json();
    expect(payload.data.recommendSkills).toHaveLength(1);
    expect(getLightweightRecommendedSkills).toHaveBeenCalledTimes(1);
    expect(getLightweightRecommendedSkills.mock.calls[0]?.[2]).toEqual([]);
    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(markRecommendDirty).toHaveBeenCalledWith(db, 'skill_1');
    expect(markRecommendFallbackServed).toHaveBeenCalledWith(db, 'skill_1');
    expect(writeRecommendPrecomputedPayload).not.toHaveBeenCalled();
    expect(upsertRecommendStateSuccess).not.toHaveBeenCalled();
  });

  it('skips repeated lightweight fallback writes during cooldown windows', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'cold',
        recommendDirty: null,
        recommendNextUpdateAt: null,
        recommendPrecomputedAt: null,
        recommendAlgoVersion: null,
        recommendLastFallbackAt: Date.now() - 5 * 60 * 1000,
      },
    ]);
    getLightweightRecommendedSkills.mockResolvedValue([
      {
        id: 'rec_1',
        name: 'Fallback Related',
        slug: 'acme/fallback-related',
        description: 'fallback',
        repoOwner: 'acme',
        repoName: 'fallback-related',
        stars: 3,
        forks: 0,
        trendingScore: 4,
        updatedAt: Date.now(),
        categories: [],
      },
    ]);

    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db } },
      request,
      locals: {},
      url: new URL(request.url),
    } as never);

    const payload = await response.json();
    expect(payload.data.recommendSkills).toHaveLength(1);
    expect(getRecommendedSkills).not.toHaveBeenCalled();
    expect(getLightweightRecommendedSkills.mock.calls[0]?.[2]).toEqual([]);
    expect(markRecommendDirty).not.toHaveBeenCalled();
    expect(markRecommendFallbackServed).not.toHaveBeenCalled();
  });

  it('does not enqueue cold lightweight fallback skills for cron backfill', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'cold',
        recommendDirty: null,
        recommendNextUpdateAt: null,
        recommendPrecomputedAt: null,
        recommendAlgoVersion: null,
        recommendLastFallbackAt: null,
      },
    ]);
    getLightweightRecommendedSkills.mockResolvedValue([
      {
        id: 'rec_1',
        name: 'Fallback Related',
        slug: 'acme/fallback-related',
        description: 'fallback',
        repoOwner: 'acme',
        repoName: 'fallback-related',
        stars: 3,
        forks: 0,
        trendingScore: 4,
        updatedAt: Date.now(),
        categories: [],
      },
    ]);

    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db } },
      request,
      locals: {},
      url: new URL(request.url),
    } as never);

    const payload = await response.json();
    expect(payload.data.recommendSkills).toHaveLength(1);
    expect(getRecommendedSkills).not.toHaveBeenCalled();
    expect(markRecommendDirty).not.toHaveBeenCalled();
    expect(markRecommendFallbackServed).toHaveBeenCalledWith(db, 'skill_1');
  });

  it('passes client-provided category hints into lightweight fallback', async () => {
    const db = createDb([
      {
        id: 'skill_1',
        slug: 'acme/demo-skill',
        repoOwner: 'acme',
        visibility: 'public',
        tier: 'cool',
        recommendDirty: null,
        recommendNextUpdateAt: null,
        recommendPrecomputedAt: null,
        recommendAlgoVersion: null,
        recommendLastFallbackAt: null,
      },
    ]);
    getLightweightRecommendedSkills.mockResolvedValue([
      {
        id: 'rec_1',
        name: 'Hinted Related',
        slug: 'acme/hinted-related',
        description: 'hinted',
        repoOwner: 'acme',
        repoName: 'hinted-related',
        stars: 5,
        forks: 0,
        trendingScore: 6,
        updatedAt: Date.now(),
        categories: [],
      },
    ]);
    const request = createRequest({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });
    const url = new URL(request.url);
    url.searchParams.append('category', 'automation');
    url.searchParams.append('category', 'coding');

    const { GET } = await import('../src/routes/api/skills/[owner]/[...name]/recommend/+server');
    const response = await GET({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: { env: { DB: db } },
      request,
      locals: {},
      url,
    } as never);

    const payload = await response.json();
    expect(payload.data.recommendSkills).toHaveLength(1);
    expect(getLightweightRecommendedSkills.mock.calls[0]?.[2]).toEqual(['automation', 'coding']);
  });
});
