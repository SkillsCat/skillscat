import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/service-worker/cache-config', () => ({
  CACHE_NAMES: {
    static: 'test-static',
    api: 'test-api',
    pages: 'test-pages',
    pageData: 'test-page-data',
  },
  STATIC_PATTERNS: [],
  API_CACHE_CONFIGS: [],
  NO_CACHE_PATTERNS: [],
}));

let hasSessionCookie: typeof import('../src/service-worker/cache-strategies').hasSessionCookie;
let isExplicitlyPublicResponse: typeof import('../src/service-worker/cache-strategies').isExplicitlyPublicResponse;

beforeAll(async () => {
  ({ hasSessionCookie, isExplicitlyPublicResponse } = await import('../src/service-worker/cache-strategies'));
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
});
