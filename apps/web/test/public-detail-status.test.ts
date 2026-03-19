import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const setPublicPageCache = vi.fn();
const getSkillBySlug = vi.fn();
const getRecommendedSkills = vi.fn();
const loadSkillReadmeFromR2 = vi.fn();
const recordSkillAccess = vi.fn();
const getCached = vi.fn();
const renderReadmeMarkdown = vi.fn((value: string) => value);

vi.mock('$lib/server/cache/page', () => ({
  setPublicPageCache,
}));

vi.mock('$lib/server/db/utils', () => ({
  getSkillBySlug,
  getRecommendedSkills,
  loadSkillReadmeFromR2,
  recordSkillAccess,
}));

vi.mock('$lib/server/cache', () => ({
  getCached,
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
});
