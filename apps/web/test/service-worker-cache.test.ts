import { beforeAll, describe, expect, it, vi } from 'vitest';

const recommendApiPattern = /^\/api\/skills\/.+\/recommend$/;
const skillPageDataPattern = /^\/skills\/.+\/__data\.json$/;
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
  PAGE_DATA_CACHE_CONFIGS: [
    {
      pattern: skillPageDataPattern,
      maxAge: 1,
      staleWhileRevalidate: 1,
      test: (value: string) => skillPageDataPattern.test(value),
    },
  ],
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
let isExplicitlyPublicResponse: typeof import('../src/service-worker/cache-strategies').isExplicitlyPublicResponse;
let getApiCacheConfig: typeof import('../src/service-worker/cache-strategies').getApiCacheConfig;
let getPageDataCacheConfig: typeof import('../src/service-worker/cache-strategies').getPageDataCacheConfig;
let getPublicAssetCacheConfig: typeof import('../src/service-worker/cache-strategies').getPublicAssetCacheConfig;

beforeAll(async () => {
  ({
    hasSessionCookie,
    isExplicitlyPublicResponse,
    getApiCacheConfig,
    getPageDataCacheConfig,
    getPublicAssetCacheConfig,
  } = await import('../src/service-worker/cache-strategies'));
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

  it('refuses to cache public responses that vary by cookie', () => {
    const response = new Response('ok', {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=60',
        Vary: 'Cookie, Accept-Language',
      },
    });

    expect(isExplicitlyPublicResponse(response)).toBe(false);
  });

  it('recognizes the public related-skills api route as cacheable', () => {
    expect(getApiCacheConfig('/api/skills/acme/demo-skill/recommend')).not.toBeNull();
    expect(getApiCacheConfig('/api/skills/acme/demo-skill/files')).toBeNull();
  });

  it('recognizes public skill detail __data.json as cautiously cacheable', () => {
    expect(getPageDataCacheConfig('/skills/acme/demo-skill/__data.json')).not.toBeNull();
    expect(getPageDataCacheConfig('/u/acme/__data.json')).toBeNull();
  });

  it('recognizes the avatar proxy as a browser-cache candidate', () => {
    expect(getPublicAssetCacheConfig('/avatar')).not.toBeNull();
    expect(getPublicAssetCacheConfig('/favicon-128x128.png')).toBeNull();
  });
});
