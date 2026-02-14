/**
 * Cloudflare Worker Cache API wrapper
 *
 * Replaces KV-based caching with the free Cache API.
 * Cache API only works in Cloudflare Workers environment (not local dev).
 */

const CACHE_DOMAIN = 'https://skills.cat/cache';
const DEFAULT_CACHE_VERSION = 'v1';
const CACHE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

// Cloudflare Workers extends CacheStorage with a 'default' property
declare const caches: CacheStorage & { default: Cache };

let activeCacheVersion = DEFAULT_CACHE_VERSION;

function normalizeCacheVersion(version: string | undefined | null): string {
  const normalized = (version || '').trim();
  if (!normalized) return DEFAULT_CACHE_VERSION;
  return CACHE_VERSION_PATTERN.test(normalized) ? normalized : DEFAULT_CACHE_VERSION;
}

function getVersionedCacheKey(cacheKey: string): string {
  return `v/${activeCacheVersion}/${cacheKey}`;
}

function buildCacheRequest(cacheKey: string): Request {
  return new Request(`${CACHE_DOMAIN}/${cacheKey}`);
}

/**
 * Set cache namespace version.
 * Call this once per request from hooks using runtime env vars.
 */
export function setCacheVersion(version: string | undefined | null): void {
  activeCacheVersion = normalizeCacheVersion(version);
}

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
    const versionedKey = getVersionedCacheKey(cacheKey);
    const versionedRequest = buildCacheRequest(versionedKey);
    const legacyRequest = buildCacheRequest(cacheKey);

    const cached = await cache.match(versionedRequest);

    if (cached) {
      const data = await cached.json() as T;
      return { data, hit: true };
    }

    // Backward-compatible fallback:
    // keep serving legacy cache after deploy, and promote it to current version.
    const legacyCached = await cache.match(legacyRequest);
    if (legacyCached) {
      const promoted = legacyCached.clone();
      const data = await legacyCached.json() as T;
      void cache.put(versionedRequest, promoted);
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
    const cacheUrl = buildCacheRequest(getVersionedCacheKey(cacheKey));
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
    const versionedKey = getVersionedCacheKey(cacheKey);
    const versionedRequest = buildCacheRequest(versionedKey);
    const legacyRequest = buildCacheRequest(cacheKey);

    const cached = await cache.match(versionedRequest);

    if (cached) {
      const data = await cached.text();
      return { data, hit: true };
    }

    const legacyCached = await cache.match(legacyRequest);
    if (legacyCached) {
      const promoted = legacyCached.clone();
      const data = await legacyCached.text();
      void cache.put(versionedRequest, promoted);
      return { data, hit: true };
    }
  } catch {
    // Cache API not available or error
  }

  const data = await fetcher();

  try {
    const cache = caches.default;
    const cacheUrl = buildCacheRequest(getVersionedCacheKey(cacheKey));
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
    const versionedUrl = buildCacheRequest(getVersionedCacheKey(cacheKey));
    const legacyUrl = buildCacheRequest(cacheKey);
    await Promise.all([
      cache.delete(versionedUrl),
      cache.delete(legacyUrl),
    ]);
  } catch {
    // Ignore errors
  }
}
