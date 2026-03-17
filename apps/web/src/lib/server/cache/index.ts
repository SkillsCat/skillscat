/**
 * Cloudflare Worker Cache API wrapper
 *
 * Replaces KV-based caching with the free Cache API.
 * Cache API only works in Cloudflare Workers environment (not local dev).
 */

const CACHE_DOMAIN = 'https://skills.cat/cache';
const DEFAULT_CACHE_VERSION = 'v1';
const CACHE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
type WaitUntilFn = (promise: Promise<unknown>) => void;

// Cloudflare Workers extends CacheStorage with a 'default' property
declare const caches: CacheStorage & { default: Cache };

let activeCacheVersion = DEFAULT_CACHE_VERSION;
const pendingJsonFetches = new Map<string, Promise<unknown>>();
const pendingTextFetches = new Map<string, Promise<string>>();
const pendingBinaryFetches = new Map<string, Promise<Uint8Array>>();

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

function scheduleCacheWrite(write: Promise<void>, waitUntil?: WaitUntilFn): void {
  const guardedWrite = write.catch(() => {
    // Ignore cache write errors.
  });

  if (waitUntil) {
    waitUntil(guardedWrite);
    return;
  }

  void guardedWrite;
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
  ttl: number,
  options?: {
    waitUntil?: WaitUntilFn;
  }
): Promise<{ data: T; hit: boolean }> {
  const versionedKey = getVersionedCacheKey(cacheKey);

  // Try to get from cache
  try {
    const cache = caches.default;
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
      scheduleCacheWrite(cache.put(versionedRequest, promoted), options?.waitUntil);
      return { data, hit: true };
    }
  } catch {
    // Cache API not available (local dev) or error, continue to fetch
  }

  const inFlight = pendingJsonFetches.get(versionedKey) as Promise<T> | undefined;
  if (inFlight) {
    const data = await inFlight;
    return { data, hit: false };
  }

  const fetchPromise = (async (): Promise<T> => {
    const data = await fetcher();

    // Store in cache (fire and forget)
    try {
      const cache = caches.default;
      const cacheUrl = buildCacheRequest(versionedKey);
      const response = new Response(JSON.stringify(data), {
        headers: {
          'Cache-Control': `public, max-age=${ttl}`,
          'Content-Type': 'application/json'
        }
      });
      scheduleCacheWrite(cache.put(cacheUrl, response), options?.waitUntil);
    } catch {
      // Ignore cache write errors
    }

    return data;
  })();

  pendingJsonFetches.set(versionedKey, fetchPromise as Promise<unknown>);

  try {
    const data = await fetchPromise;
    return { data, hit: false };
  } finally {
    pendingJsonFetches.delete(versionedKey);
  }
}

/**
 * Get cached text data (for non-JSON responses like XML)
 */
export async function getCachedText(
  cacheKey: string,
  fetcher: () => Promise<string>,
  ttl: number,
  options?: {
    waitUntil?: WaitUntilFn;
  }
): Promise<{ data: string; hit: boolean }> {
  const versionedKey = getVersionedCacheKey(cacheKey);

  try {
    const cache = caches.default;
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
      scheduleCacheWrite(cache.put(versionedRequest, promoted), options?.waitUntil);
      return { data, hit: true };
    }
  } catch {
    // Cache API not available or error
  }

  const inFlight = pendingTextFetches.get(versionedKey);
  if (inFlight) {
    const data = await inFlight;
    return { data, hit: false };
  }

  const fetchPromise = (async (): Promise<string> => {
    const data = await fetcher();

    try {
      const cache = caches.default;
      const cacheUrl = buildCacheRequest(versionedKey);
      const response = new Response(data, {
        headers: {
          'Cache-Control': `public, max-age=${ttl}`,
          'Content-Type': 'text/plain'
        }
      });
      scheduleCacheWrite(cache.put(cacheUrl, response), options?.waitUntil);
    } catch {
      // Ignore cache write errors
    }

    return data;
  })();

  pendingTextFetches.set(versionedKey, fetchPromise);

  try {
    const data = await fetchPromise;
    return { data, hit: false };
  } finally {
    pendingTextFetches.delete(versionedKey);
  }
}

/**
 * Get cached binary data (for zip downloads or other non-text payloads).
 */
export async function getCachedBinary(
  cacheKey: string,
  fetcher: () => Promise<Uint8Array>,
  ttl: number,
  options?: {
    waitUntil?: WaitUntilFn;
    contentType?: string;
  }
): Promise<{ data: Uint8Array; hit: boolean }> {
  const versionedKey = getVersionedCacheKey(cacheKey);

  try {
    const cache = caches.default;
    const versionedRequest = buildCacheRequest(versionedKey);
    const legacyRequest = buildCacheRequest(cacheKey);

    const cached = await cache.match(versionedRequest);
    if (cached) {
      const data = new Uint8Array(await cached.arrayBuffer());
      return { data, hit: true };
    }

    const legacyCached = await cache.match(legacyRequest);
    if (legacyCached) {
      const promoted = legacyCached.clone();
      const data = new Uint8Array(await legacyCached.arrayBuffer());
      scheduleCacheWrite(cache.put(versionedRequest, promoted), options?.waitUntil);
      return { data, hit: true };
    }
  } catch {
    // Cache API not available or error
  }

  const inFlight = pendingBinaryFetches.get(versionedKey);
  if (inFlight) {
    const data = await inFlight;
    return { data, hit: false };
  }

  const fetchPromise = (async (): Promise<Uint8Array> => {
    const data = await fetcher();

    try {
      const cache = caches.default;
      const cacheUrl = buildCacheRequest(versionedKey);
      const response = new Response(data.slice(), {
        headers: {
          'Cache-Control': `public, max-age=${ttl}`,
          'Content-Type': options?.contentType || 'application/octet-stream',
        },
      });
      scheduleCacheWrite(cache.put(cacheUrl, response), options?.waitUntil);
    } catch {
      // Ignore cache write errors
    }

    return data;
  })();

  pendingBinaryFetches.set(versionedKey, fetchPromise);

  try {
    const data = await fetchPromise;
    return { data, hit: false };
  } finally {
    pendingBinaryFetches.delete(versionedKey);
  }
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
