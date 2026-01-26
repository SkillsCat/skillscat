/**
 * Cloudflare Worker Cache API wrapper
 *
 * Replaces KV-based caching with the free Cache API.
 * Cache API only works in Cloudflare Workers environment (not local dev).
 */

const CACHE_DOMAIN = 'https://skillscat.dev/cache';

// Cloudflare Workers extends CacheStorage with a 'default' property
declare const caches: CacheStorage & { default: Cache };

/**
 * Get cached data or fetch fresh data
 *
 * @param cacheKey - Unique cache key (e.g., 'api:categories')
 * @param fetcher - Function to fetch fresh data if cache miss
 * @param ttl - Time to live in seconds
 * @returns Object with data and cache hit status
 */
export async function getCached<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttl: number
): Promise<{ data: T; hit: boolean }> {
  // Try to get from cache
  try {
    const cache = caches.default;
    const cacheUrl = new Request(`${CACHE_DOMAIN}/${cacheKey}`);
    const cached = await cache.match(cacheUrl);

    if (cached) {
      const data = await cached.json() as T;
      return { data, hit: true };
    }
  } catch {
    // Cache API not available (local dev) or error, continue to fetch
  }

  // Fetch fresh data
  const data = await fetcher();

  // Store in cache (fire and forget)
  try {
    const cache = caches.default;
    const cacheUrl = new Request(`${CACHE_DOMAIN}/${cacheKey}`);
    const response = new Response(JSON.stringify(data), {
      headers: {
        'Cache-Control': `public, max-age=${ttl}`,
        'Content-Type': 'application/json'
      }
    });
    // Don't await - let it happen in background
    cache.put(cacheUrl, response);
  } catch {
    // Ignore cache write errors
  }

  return { data, hit: false };
}

/**
 * Get cached text data (for non-JSON responses like XML)
 */
export async function getCachedText(
  cacheKey: string,
  fetcher: () => Promise<string>,
  ttl: number
): Promise<{ data: string; hit: boolean }> {
  try {
    const cache = caches.default;
    const cacheUrl = new Request(`${CACHE_DOMAIN}/${cacheKey}`);
    const cached = await cache.match(cacheUrl);

    if (cached) {
      const data = await cached.text();
      return { data, hit: true };
    }
  } catch {
    // Cache API not available or error
  }

  const data = await fetcher();

  try {
    const cache = caches.default;
    const cacheUrl = new Request(`${CACHE_DOMAIN}/${cacheKey}`);
    const response = new Response(data, {
      headers: {
        'Cache-Control': `public, max-age=${ttl}`,
        'Content-Type': 'text/plain'
      }
    });
    cache.put(cacheUrl, response);
  } catch {
    // Ignore cache write errors
  }

  return { data, hit: false };
}

/**
 * Invalidate a cache entry
 */
export async function invalidateCache(cacheKey: string): Promise<void> {
  try {
    const cache = caches.default;
    const cacheUrl = new Request(`${CACHE_DOMAIN}/${cacheKey}`);
    await cache.delete(cacheUrl);
  } catch {
    // Ignore errors
  }
}
