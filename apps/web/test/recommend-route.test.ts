import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCached = vi.fn();
const invalidateCache = vi.fn();
const getAuthContext = vi.fn();
const requireScope = vi.fn();
const checkSkillAccess = vi.fn();
const getRecommendedSkills = vi.fn();
const isOpenClawUserAgent = vi.fn();
const readCachedRecommendSkills = vi.fn();
const shouldRefreshPrecomputedRecommend = vi.fn();
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
  isOpenClawUserAgent.mockReturnValue(false);
  readCachedRecommendSkills.mockResolvedValue({
    recommendSkills: null,
    hit: false,
    algoVersion: 'v1',
  });
  shouldRefreshPrecomputedRecommend.mockReturnValue(false);
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
});
