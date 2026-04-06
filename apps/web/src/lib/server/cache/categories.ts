import { invalidateCache } from '$lib/server/cache';
import {
  getCategoryHtmlCacheKeys,
  PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
} from '$lib/server/cache/keys';

export function getCategoryPageCacheKey(categorySlug: string, page = 1): string {
  return `page:category:v1:${categorySlug}:${page}`;
}

export function getCategoryPageCacheInvalidationKeys(categorySlug: string): string[] {
  return [
    getCategoryPageCacheKey(categorySlug),
    ...getCategoryHtmlCacheKeys(categorySlug),
  ];
}

export function getCategoryCacheInvalidationKeys(categorySlugs: Iterable<string>): string[] {
  const cacheKeys = new Set<string>(PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS);

  for (const slug of categorySlugs) {
    if (typeof slug === 'string' && slug.length > 0) {
      for (const cacheKey of getCategoryPageCacheInvalidationKeys(slug)) {
        cacheKeys.add(cacheKey);
      }
    }
  }

  return [...cacheKeys];
}

export async function invalidateCategoryCaches(categorySlugs: Iterable<string>): Promise<void> {
  await Promise.all(
    getCategoryCacheInvalidationKeys(categorySlugs).map((cacheKey) => invalidateCache(cacheKey))
  );
}
