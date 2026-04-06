import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCachedBinary = vi.fn();
const getCategoryBySlug = vi.fn((slug: string) => (
  slug === 'productivity'
    ? { slug, name: 'Productivity', description: 'Productivity skills' }
    : null
));
const fetchPublicTextAsset = vi.fn();
const fetchPublicBinaryAsset = vi.fn();
const fetchPublicDataUri = vi.fn();

vi.mock('$lib/server/cache', () => ({
  getCachedBinary,
}));

vi.mock('$lib/server/cache/public-assets', () => ({
  fetchPublicTextAsset,
  fetchPublicBinaryAsset,
  fetchPublicDataUri,
}));

vi.mock('$lib/constants/categories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/constants/categories')>();
  return {
    ...actual,
    getCategoryBySlug,
  };
});

vi.mock('@cf-wasm/resvg', () => ({
  Resvg: class MockResvg {
    render() {
      return {
        asPng: () => new Uint8Array([1, 2, 3, 4]),
      };
    }
  },
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  getCachedBinary.mockReset();
  getCategoryBySlug.mockClear();
  fetchPublicTextAsset.mockReset();
  fetchPublicBinaryAsset.mockReset();
  fetchPublicDataUri.mockReset();
});

describe('og route caching', () => {
  it('serves cached pngs without touching D1 on cache hits', async () => {
    getCachedBinary.mockResolvedValue({
      data: new Uint8Array([9, 9, 9]),
      hit: true,
    });

    const prepare = vi.fn();
    const { GET } = await import('../src/routes/og/+server');
    const response = await GET({
      url: new URL('https://skills.cat/og?type=skill&slug=acme/demo-skill&v=1712345678'),
      request: new Request('https://skills.cat/og?type=skill&slug=acme/demo-skill&v=1712345678'),
      platform: {
        env: { DB: { prepare } },
        context: { waitUntil: vi.fn() },
      },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-cache')).toBe('HIT');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, s-maxage=31536000, immutable');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('uses a lightweight skill query and long-lived binary cache on misses', async () => {
    fetchPublicTextAsset.mockResolvedValue({
      data: '@font-face { src: url(https://fonts.gstatic.com/test-font.ttf); }',
      contentType: 'text/css',
      hit: false,
    });
    fetchPublicBinaryAsset.mockResolvedValue({
      data: new Uint8Array([0, 1, 2, 3]),
      contentType: 'font/ttf',
      hit: false,
    });
    fetchPublicDataUri.mockResolvedValue({
      dataUri: 'data:image/png;base64,iVBORw0KGgo=',
      contentType: 'image/png',
      hit: false,
    });

    const waitUntil = vi.fn();
    const first = vi.fn(async () => ({
      name: 'Demo Skill',
      slug: 'acme/demo-skill',
      description: 'A fast OG image test',
      repo_owner: 'acme',
      repo_name: 'demo-skill',
      skill_path: '',
      stars: 42,
      source_type: 'github',
      visibility: 'public',
      author_display_name: 'Acme',
      author_avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
      category_slug: 'productivity',
    }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));

    let capturedKey = '';
    let capturedTtl = 0;
    let capturedWaitUntil: unknown;
    getCachedBinary.mockImplementation(async (cacheKey, fetcher, ttl, options) => {
      capturedKey = String(cacheKey);
      capturedTtl = Number(ttl);
      capturedWaitUntil = options?.waitUntil;
      return {
        data: await fetcher(),
        hit: false,
      };
    });

    const { GET } = await import('../src/routes/og/+server');
    const response = await GET({
      url: new URL('https://skills.cat/og?type=skill&slug=acme/demo-skill&v=1712345678'),
      request: new Request('https://skills.cat/og?type=skill&slug=acme/demo-skill&v=1712345678'),
      platform: {
        env: { DB: { prepare } },
        context: { waitUntil },
      },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(capturedTtl).toBe(31536000);
    expect(capturedKey).toBe('og:image:2026-03-01:skill:acme%2Fdemo-skill:1712345678');
    expect(capturedWaitUntil).toEqual(expect.any(Function));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith('acme/demo-skill');

    const sql = String(prepare.mock.calls[0]?.[0] || '');
    expect(sql).toContain('FROM skills s');
    expect(sql).toContain('LEFT JOIN authors a ON a.username = s.repo_owner');
    expect(sql).not.toContain('s.*');
    expect(sql).not.toContain('json_group_array');
    expect(sql).not.toContain('skill_security_state');
    expect(sql).not.toContain('LEFT JOIN user');
  });

  it('short-circuits conditional requests before cache lookup or rendering', async () => {
    getCachedBinary.mockResolvedValue({
      data: new Uint8Array([7, 7, 7]),
      hit: true,
    });

    const { GET } = await import('../src/routes/og/+server');
    const firstResponse = await GET({
      url: new URL('https://skills.cat/og?type=page&slug=home&v=2026-03-01'),
      request: new Request('https://skills.cat/og?type=page&slug=home&v=2026-03-01'),
      platform: {
        env: {},
        context: { waitUntil: vi.fn() },
      },
    } as never);

    const etag = firstResponse.headers.get('etag');
    expect(etag).toBeTruthy();

    getCachedBinary.mockClear();

    const response = await GET({
      url: new URL('https://skills.cat/og?type=page&slug=home&v=2026-03-01'),
      request: new Request('https://skills.cat/og?type=page&slug=home&v=2026-03-01', {
        headers: { 'If-None-Match': String(etag) },
      }),
      platform: {
        env: {},
        context: { waitUntil: vi.fn() },
      },
    } as never);

    expect(response.status).toBe(304);
    expect(response.headers.get('x-cache')).toBe('REVALIDATED');
    expect(getCachedBinary).not.toHaveBeenCalled();
  });
});
