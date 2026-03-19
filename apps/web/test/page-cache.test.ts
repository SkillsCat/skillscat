import { describe, expect, it } from 'vitest';

import { LOCALE_COOKIE_NAME } from '$lib/i18n/config';
import { setPublicPageCache } from '$lib/server/cache/page';

describe('setPublicPageCache', () => {
  it('marks authenticated page responses as private and cookie-bound', () => {
    const headers: Record<string, string> = {};

    setPublicPageCache({
      setHeaders: (next) => Object.assign(headers, next),
      request: new Request('https://skills.cat/trending'),
      isAuthenticated: true,
      sMaxAge: 60,
      staleWhileRevalidate: 180,
    });

    expect(headers).toEqual({
      'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      Vary: 'Cookie',
    });
  });

  it('varies anonymous public pages by cookie and accept-language when locale comes from headers', () => {
    const headers: Record<string, string> = {};

    setPublicPageCache({
      setHeaders: (next) => Object.assign(headers, next),
      request: new Request('https://skills.cat/trending', {
        headers: {
          'accept-language': 'zh-CN,zh;q=0.9',
        },
      }),
      isAuthenticated: false,
      sMaxAge: 60,
      staleWhileRevalidate: 180,
    });

    expect(headers).toEqual({
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=180',
      Vary: 'Cookie, Accept-Language',
    });
  });

  it('does not add accept-language to vary when locale already comes from a cookie', () => {
    const headers: Record<string, string> = {};

    setPublicPageCache({
      setHeaders: (next) => Object.assign(headers, next),
      request: new Request('https://skills.cat/trending', {
        headers: {
          cookie: `${LOCALE_COOKIE_NAME}=zh-CN; theme=light`,
        },
      }),
      isAuthenticated: false,
      sMaxAge: 60,
      staleWhileRevalidate: 180,
    });

    expect(headers).toEqual({
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=180',
      Vary: 'Cookie',
    });
  });

  it('can collapse anonymous indexable pages to cookie-only vary', () => {
    const headers: Record<string, string> = {};

    setPublicPageCache({
      setHeaders: (next) => Object.assign(headers, next),
      request: new Request('https://skills.cat/trending', {
        headers: {
          'accept-language': 'zh-CN,zh;q=0.9',
        },
      }),
      isAuthenticated: false,
      sMaxAge: 60,
      staleWhileRevalidate: 180,
      varyByLanguageHeader: false,
    });

    expect(headers).toEqual({
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=180',
      Vary: 'Cookie',
    });
  });
});
