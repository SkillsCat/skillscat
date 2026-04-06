import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const setPublicPageCache = vi.fn();
const getSkillBySlug = vi.fn();
const getRecommendedSkills = vi.fn();
const loadSkillReadmeFromR2 = vi.fn();
const getCached = vi.fn();
const renderReadmeMarkdown = vi.fn((value: string) => value);
const readCachedRecommendSkills = vi.fn();
const readRecommendRefreshState = vi.fn();
const shouldRefreshPrecomputedRecommend = vi.fn();

vi.mock('$lib/server/cache/page', () => ({
  setPublicPageCache,
}));

vi.mock('$lib/server/db/business/detail', () => ({
  getSkillBySlug,
}));

vi.mock('$lib/server/db/business/recommend', () => ({
  getRecommendedSkills,
}));

vi.mock('$lib/server/db/business/readme', () => ({
  loadSkillReadmeFromR2,
}));

vi.mock('$lib/server/cache', () => ({
  getCached,
}));

vi.mock('$lib/server/ranking/recommend-cache', () => ({
  readCachedRecommendSkills,
  readRecommendRefreshState,
  shouldRefreshPrecomputedRecommend,
  RECOMMEND_ONLINE_CACHE_TTL_SECONDS: 6 * 60 * 60,
}));

vi.mock('$lib/server/text/markdown', () => ({
  renderReadmeMarkdown,
}));

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

function createHeadersRecorder() {
  const headers = new Map<string, string>();
  const setHeaders = vi.fn((next: Record<string, string>) => {
    for (const [key, value] of Object.entries(next)) {
      headers.set(key, value);
    }
  });

  return { headers, setHeaders };
}

function createPlatform() {
  return {
    env: {
      DB: undefined,
      R2: undefined,
      KV: undefined,
    },
    context: {
      waitUntil: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy.mockClear();
  getCached.mockImplementation(async (_cacheKey: string, fetcher: () => Promise<unknown>) => ({
    data: await fetcher(),
    hit: false,
  }));
  readCachedRecommendSkills.mockResolvedValue({
    recommendSkills: null,
    hit: false,
    algoVersion: 'v1',
  });
  readRecommendRefreshState.mockResolvedValue(null);
  shouldRefreshPrecomputedRecommend.mockReturnValue(false);
  renderReadmeMarkdown.mockImplementation((value: string) => value);
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

describe('public detail status overrides', () => {
  it('returns a rendered org fallback with 500 override on temporary upstream failures', async () => {
    const { headers, setHeaders } = createHeadersRecorder();
    const fetch = vi.fn(async () => new Response(null, { status: 502 }));
    const { load } = await import('../src/routes/org/[slug]/+page.server');

    const result = await load({
      params: { slug: 'acme' },
      fetch,
      setHeaders,
      locals: { user: null },
      request: new Request('https://skills.cat/org/acme'),
      platform: createPlatform(),
    } as never);

    expect(result).toMatchObject({
      slug: 'acme',
      org: null,
      errorKind: 'temporary_failure',
      error: 'Failed to load organization',
    });
    expect(headers.get('X-Skillscat-Status-Override')).toBe('500');
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps org not-found responses as 404 overrides', async () => {
    const { headers, setHeaders } = createHeadersRecorder();
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const { load } = await import('../src/routes/org/[slug]/+page.server');

    const result = await load({
      params: { slug: 'missing-org' },
      fetch,
      setHeaders,
      locals: { user: null },
      request: new Request('https://skills.cat/org/missing-org'),
      platform: createPlatform(),
    } as never);

    expect(result).toMatchObject({
      slug: 'missing-org',
      org: null,
      errorKind: 'not_found',
      error: 'Organization not found',
    });
    expect(headers.get('X-Skillscat-Status-Override')).toBe('404');
    expect(headers.has('Cache-Control')).toBe(false);
  });

  it('returns a rendered skill fallback with 500 override on temporary detail failures', async () => {
    getSkillBySlug.mockRejectedValue(new Error('D1 unavailable'));

    const { headers, setHeaders } = createHeadersRecorder();
    const { load } = await import('../src/routes/skills/[owner]/[...name]/+page.server');

    const result = await load({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: createPlatform(),
      locals: { user: null },
      request: new Request('https://skills.cat/skills/acme/demo-skill'),
      fetch: vi.fn(),
      setHeaders,
      isDataRequest: false,
    } as never);

    expect(result).toMatchObject({
      skill: null,
      recommendSkills: [],
      errorKind: 'temporary_failure',
      error: 'Failed to load skill',
    });
    expect(headers.get('X-Skillscat-Status-Override')).toBe('500');
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps skill not-found responses as 404 overrides', async () => {
    getSkillBySlug.mockResolvedValue(null);

    const { headers, setHeaders } = createHeadersRecorder();
    const { load } = await import('../src/routes/skills/[owner]/[...name]/+page.server');

    const result = await load({
      params: { owner: 'acme', name: 'missing-skill' },
      platform: createPlatform(),
      locals: { user: null },
      request: new Request('https://skills.cat/skills/acme/missing-skill'),
      fetch: vi.fn(),
      setHeaders,
      isDataRequest: false,
    } as never);

    expect(result).toMatchObject({
      skill: null,
      recommendSkills: [],
      errorKind: 'not_found',
      error: 'Skill not found or you do not have permission to view it.',
    });
    expect(headers.get('X-Skillscat-Status-Override')).toBe('404');
    expect(headers.has('Cache-Control')).toBe(false);
  });

  it('inlines cached related skills on the first detail render', async () => {
    getSkillBySlug.mockResolvedValue({
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
      lastCommitAt: null,
      createdAt: Date.now(),
      indexedAt: Date.now(),
      readme: '# Demo',
      fileStructure: null,
      categories: ['automation'],
      classificationMethod: null,
      authorAvatar: null,
      authorUsername: 'acme',
      authorDisplayName: 'Acme',
      authorBio: null,
      authorSkillsCount: 1,
      authorTotalStars: 10,
      visibility: 'public',
      sourceType: 'github',
      ownerId: null,
      ownerName: null,
      ownerAvatar: null,
      orgId: null,
      orgName: null,
      orgSlug: null,
      orgAvatar: null,
    });
    readCachedRecommendSkills.mockResolvedValue({
      recommendSkills: [{
        id: 'skill_2',
        name: 'Related Skill',
        slug: 'acme/related-skill',
        description: 'Related',
        repoOwner: 'acme',
        repoName: 'related-skill',
        stars: 5,
        forks: 0,
        trendingScore: 2,
        updatedAt: Date.now(),
        categories: ['automation'],
        authorAvatar: undefined,
      }],
      hit: true,
      algoVersion: 'v1',
    });

    const { headers, setHeaders } = createHeadersRecorder();
    const fetch = vi.fn();
    const { load } = await import('../src/routes/skills/[owner]/[...name]/+page.server');

    const result = await load({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: createPlatform(),
      locals: { user: null },
      request: new Request('https://skills.cat/skills/acme/demo-skill'),
      fetch,
      setHeaders,
      isDataRequest: false,
    } as never);

    expect(result.deferRecommendSkills).toBe(false);
    expect(result.recommendSkills).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(getRecommendedSkills).not.toHaveBeenCalled();
    expect(headers.get('X-Skillscat-Public-Skill-Cache')).toBe('1');
    expect(readRecommendRefreshState).toHaveBeenCalledWith(undefined, 'skill_1');
  });

  it('schedules a background refresh when cached related skills are stale', async () => {
    getSkillBySlug.mockResolvedValue({
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
      lastCommitAt: null,
      createdAt: Date.now(),
      indexedAt: Date.now(),
      readme: '# Demo',
      fileStructure: null,
      categories: ['automation'],
      classificationMethod: null,
      authorAvatar: null,
      authorUsername: 'acme',
      authorDisplayName: 'Acme',
      authorBio: null,
      authorSkillsCount: 1,
      authorTotalStars: 10,
      visibility: 'public',
      sourceType: 'github',
      ownerId: null,
      ownerName: null,
      ownerAvatar: null,
      orgId: null,
      orgName: null,
      orgSlug: null,
      orgAvatar: null,
    });
    readCachedRecommendSkills.mockResolvedValue({
      recommendSkills: [{
        id: 'skill_2',
        name: 'Related Skill',
        slug: 'acme/related-skill',
        description: 'Related',
        repoOwner: 'acme',
        repoName: 'related-skill',
        stars: 5,
        forks: 0,
        trendingScore: 2,
        updatedAt: Date.now(),
        categories: ['automation'],
        authorAvatar: undefined,
      }],
      hit: true,
      algoVersion: 'v1',
    });
    readRecommendRefreshState.mockResolvedValue({
      recommendDirty: 1,
      recommendNextUpdateAt: null,
      recommendPrecomputedAt: Date.now(),
      recommendAlgoVersion: 'v1',
    });
    shouldRefreshPrecomputedRecommend.mockReturnValue(true);

    const { setHeaders } = createHeadersRecorder();
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { recommendSkills: [] },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const platform = createPlatform();
    const { load } = await import('../src/routes/skills/[owner]/[...name]/+page.server');

    const result = await load({
      params: { owner: 'acme', name: 'demo-skill' },
      platform,
      locals: { user: null },
      request: new Request('https://skills.cat/skills/acme/demo-skill'),
      fetch,
      setHeaders,
      isDataRequest: false,
    } as never);

    expect(result.deferRecommendSkills).toBe(false);
    expect(platform.context.waitUntil).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/skills/acme/demo-skill/recommend', {
      headers: { accept: 'application/json' },
    });
  });

  it('defers uncached related skills on the first detail render', async () => {
    getSkillBySlug.mockResolvedValue({
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
      lastCommitAt: null,
      createdAt: Date.now(),
      indexedAt: Date.now(),
      readme: '# Demo',
      fileStructure: null,
      categories: ['automation'],
      classificationMethod: null,
      authorAvatar: null,
      authorUsername: 'acme',
      authorDisplayName: 'Acme',
      authorBio: null,
      authorSkillsCount: 1,
      authorTotalStars: 10,
      visibility: 'public',
      sourceType: 'github',
      ownerId: null,
      ownerName: null,
      ownerAvatar: null,
      orgId: null,
      orgName: null,
      orgSlug: null,
      orgAvatar: null,
    });

    const { setHeaders } = createHeadersRecorder();
    const fetch = vi.fn();
    const { load } = await import('../src/routes/skills/[owner]/[...name]/+page.server');

    const result = await load({
      params: { owner: 'acme', name: 'demo-skill' },
      platform: createPlatform(),
      locals: { user: null },
      request: new Request('https://skills.cat/skills/acme/demo-skill'),
      fetch,
      setHeaders,
      isDataRequest: false,
    } as never);

    expect(result.deferRecommendSkills).toBe(true);
    expect(result.recommendSkills).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(getRecommendedSkills).not.toHaveBeenCalled();
  });
});
