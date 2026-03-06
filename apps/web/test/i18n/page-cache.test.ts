import { describe, expect, it } from 'vitest';

import { setPublicPageCache } from '../../src/lib/server/page-cache';

function collectHeaders(
  input: Parameters<typeof setPublicPageCache>[0]
): Record<string, string> {
  const headers: Record<string, string> = {};

  setPublicPageCache({
    ...input,
    setHeaders(next) {
      Object.assign(headers, next);
    },
  });

  return headers;
}

describe('setPublicPageCache', () => {
  it('varies on Accept-Language for anonymous requests without a locale cookie', () => {
    const headers = collectHeaders({
      request: new Request('https://skillscat.ai/trending', {
        headers: {
          'accept-language': 'ja-JP',
        },
      }),
      isAuthenticated: false,
      sMaxAge: 300,
      staleWhileRevalidate: 600,
    });

    expect(headers['Cache-Control']).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=600'
    );
    expect(headers.Vary).toBe('Accept-Language');
  });

  it('varies on Cookie when the locale cookie is present', () => {
    const headers = collectHeaders({
      request: new Request('https://skillscat.ai/trending', {
        headers: {
          cookie: 'sc_locale=zh-CN; theme=cute',
        },
      }),
      isAuthenticated: false,
      sMaxAge: 300,
      staleWhileRevalidate: 600,
    });

    expect(headers['Cache-Control']).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=600'
    );
    expect(headers.Vary).toBe('Cookie');
  });

  it('uses private caching for authenticated requests', () => {
    const headers = collectHeaders({
      request: new Request('https://skillscat.ai/trending', {
        headers: {
          cookie: 'session=abc123',
        },
      }),
      isAuthenticated: true,
      sMaxAge: 300,
      staleWhileRevalidate: 600,
    });

    expect(headers['Cache-Control']).toBe('private, max-age=30, stale-while-revalidate=60');
    expect(headers.Vary).toBe('Cookie');
  });
});
