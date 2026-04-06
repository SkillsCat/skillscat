import { describe, expect, it } from 'vitest';

import { LOCALES } from '$lib/i18n/config';
import { getCategoryCacheInvalidationKeys } from '$lib/server/cache/categories';
import {
  getCategoryHtmlCacheKey,
  getDiscoveryHtmlCacheKey,
  HOME_RECENT_CACHE_KEY,
  HOME_TOP_CACHE_KEY,
  PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
} from '$lib/server/cache/keys';
import { getPublicDiscoveryHtmlCacheKey } from '$lib/server/cache/public-html';

describe('getPublicDiscoveryHtmlCacheKey', () => {
  it('returns a shared cache key for the first page of discovery routes', () => {
    expect(
      getPublicDiscoveryHtmlCacheKey({
        routeId: '/trending',
        locale: 'en',
        searchParams: new URL('https://skills.cat/trending').searchParams,
      })
    ).toBe(getDiscoveryHtmlCacheKey('en', 'trending'));

    expect(
      getPublicDiscoveryHtmlCacheKey({
        routeId: '/recent',
        locale: 'en',
        searchParams: new URL('https://skills.cat/recent?page=1&utm_source=x').searchParams,
      })
    ).toBe(getDiscoveryHtmlCacheKey('en', 'recent'));

    expect(
      getPublicDiscoveryHtmlCacheKey({
        routeId: '/category/[slug]',
        locale: 'zh-CN',
        searchParams: new URL('https://skills.cat/category/seo?page=1').searchParams,
        params: { slug: 'seo' },
      })
    ).toBe(getCategoryHtmlCacheKey('zh-CN', 'seo'));
  });

  it('skips shared HTML caching for later paginated pages or missing category slugs', () => {
    expect(
      getPublicDiscoveryHtmlCacheKey({
        routeId: '/top',
        locale: 'en',
        searchParams: new URL('https://skills.cat/top?page=2').searchParams,
      })
    ).toBeNull();

    expect(
      getPublicDiscoveryHtmlCacheKey({
        routeId: '/category/[slug]',
        locale: 'en',
        searchParams: new URL('https://skills.cat/category').searchParams,
        params: {},
      })
    ).toBeNull();
  });
});

describe('public cache invalidation keys', () => {
  it('includes the homepage secondary list caches in discovery invalidation', () => {
    expect(PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS).toContain(HOME_RECENT_CACHE_KEY);
    expect(PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS).toContain(HOME_TOP_CACHE_KEY);
  });

  it('includes category HTML caches for every locale', () => {
    const keys = getCategoryCacheInvalidationKeys(['seo']);

    expect(keys).toContain('page:category:v1:seo:1');

    for (const locale of LOCALES) {
      expect(keys).toContain(getCategoryHtmlCacheKey(locale, 'seo'));
    }
  });
});
