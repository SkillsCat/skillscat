import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const recommendApiPattern = /^\/api\/skills\/.+\/recommend$/;
const avatarPattern = /^\/avatar$/;

vi.mock('../src/service-worker/cache-config', () => ({
  CACHE_NAMES: {
    static: 'test-static',
    api: 'test-api',
    pages: 'test-pages',
    pageData: 'test-page-data',
    publicAssets: 'test-public-assets',
  },
  STATIC_PATTERNS: [],
  API_CACHE_CONFIGS: [
    {
      pattern: recommendApiPattern,
      maxAge: 1,
      staleWhileRevalidate: 1,
      test: (value: string) => recommendApiPattern.test(value),
    },
  ],
  PAGE_DATA_CACHE_CONFIGS: [],
  PUBLIC_ASSET_CACHE_CONFIGS: [
    {
      pattern: avatarPattern,
      maxAge: 1,
      staleWhileRevalidate: 1,
      test: (value: string) => avatarPattern.test(value),
    },
  ],
  NO_CACHE_PATTERNS: [],
}));

let hasSessionCookie: typeof import('../src/service-worker/cache-strategies').hasSessionCookie;
let hasAuthCredentials: typeof import('../src/service-worker/cache-strategies').hasAuthCredentials;
let isExplicitlyPublicResponse: typeof import('../src/service-worker/cache-strategies').isExplicitlyPublicResponse;
let staleWhileRevalidate: typeof import('../src/service-worker/cache-strategies').staleWhileRevalidate;
let getApiCacheConfig: typeof import('../src/service-worker/cache-strategies').getApiCacheConfig;
let getPageDataCacheConfig: typeof import('../src/service-worker/cache-strategies').getPageDataCacheConfig;
let getPublicAssetCacheConfig: typeof import('../src/service-worker/cache-strategies').getPublicAssetCacheConfig;

beforeAll(async () => {
  ({
    hasSessionCookie,
    hasAuthCredentials,
    isExplicitlyPublicResponse,
    staleWhileRevalidate,
    getApiCacheConfig,
    getPageDataCacheConfig,
    getPublicAssetCacheConfig,
  } = await import('../src/service-worker/cache-strategies'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service worker page cache guards', () => {
  it('detects auth/session cookies but ignores unrelated cookies', () => {
    expect(
      hasSessionCookie(
        new Request('https://skills.cat/trending', {
          headers: {
            cookie: 'better-auth.session_token=abc123; theme=light',
          },
        })
      )
    ).toBe(true);

    expect(
      hasSessionCookie(
        new Request('https://skills.cat/trending', {
          headers: {
            cookie: 'sc_locale=zh-CN; theme=light',
          },
        })
      )
    ).toBe(false);
  });

  it('detects bearer tokens and session cookies as authenticated cache contexts', () => {
    expect(
      hasAuthCredentials(
        new Request('https://skills.cat/api/skills/acme/private-skill', {
          headers: { Authorization: 'Bearer secret-token' },
        })
      )
    ).toBe(true);

    expect(
      hasAuthCredentials(
        new Request('https://skills.cat/api/skills/acme/private-skill', {
          headers: { cookie: 'better-auth.session_token=abc123' },
        })
      )
    ).toBe(true);

    expect(hasAuthCredentials(new Request('https://skills.cat/api/categories'))).toBe(false);
  });

  it('refuses to cache public responses that vary by cookie', () => {
    const response = new Response('ok', {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=60',
        Vary: 'Cookie, Accept-Language',
      },
    });

    expect(isExplicitlyPublicResponse(response)).toBe(false);
  });

  it('does not cache private api responses and removes an older public entry', async () => {
    const cachedResponse = new Response('old public response', {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'sw-cache-time': '0',
      },
    });
    const cache = {
      match: vi.fn().mockResolvedValue(cachedResponse),
      put: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue(cache),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private response', {
      headers: {
        'Cache-Control': 'private, no-cache',
        Vary: 'Authorization',
      },
    })));

    const response = await staleWhileRevalidate(
      new Request('https://skills.cat/api/skills/acme/private-skill'),
      { pattern: /.*/, maxAge: 1, staleWhileRevalidate: 1 },
      { shouldCacheResponse: isExplicitlyPublicResponse }
    );

    expect(await response.text()).toBe('private response');
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.delete).toHaveBeenCalledOnce();
  });

  it('recognizes the public related-skills api route as cacheable', () => {
    expect(getApiCacheConfig('/api/skills/acme/demo-skill/recommend')).not.toBeNull();
    expect(getApiCacheConfig('/api/skills/acme/demo-skill/files')).toBeNull();
  });

  it('keeps skill detail __data.json on network-first to respect visibility changes', () => {
    expect(getPageDataCacheConfig('/skills/acme/demo-skill/__data.json')).toBeNull();
    expect(getPageDataCacheConfig('/u/acme/__data.json')).toBeNull();
  });

  it('recognizes the avatar proxy as a browser-cache candidate', () => {
    expect(getPublicAssetCacheConfig('/avatar')).not.toBeNull();
    expect(getPublicAssetCacheConfig('/favicon-128x128.png')).toBeNull();
  });
});
