import { invalidateCache } from '$lib/server/cache';
import { PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS } from '$lib/server/cache/keys';

export function getCategoryPageCacheKey(categorySlug: string, page = 1): string {
  return `page:category:v1:${categorySlug}:${page}`;
}

export function getCategoryCacheInvalidationKeys(categorySlugs: Iterable<string>): string[] {
  const cacheKeys = new Set<string>(PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS);

  for (const slug of categorySlugs) {
    if (typeof slug === 'string' && slug.length > 0) {
      cacheKeys.add(getCategoryPageCacheKey(slug));
    }
  }

  return [...cacheKeys];
}

export async function invalidateCategoryCaches(categorySlugs: Iterable<string>): Promise<void> {
  await Promise.all(
    getCategoryCacheInvalidationKeys(categorySlugs).map((cacheKey) => invalidateCache(cacheKey))
  );
}
