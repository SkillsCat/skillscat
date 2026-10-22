/**
 * Cloudflare Worker Cache API wrapper
 *
 * Replaces KV-based caching with the free Cache API.
 * Cache API only works in Cloudflare Workers environment (not local dev).
 */

const CACHE_DOMAIN = 'https://skills.cat/cache';
const DEFAULT_CACHE_VERSION = 'v2';
const CACHE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
type WaitUntilFn = (promise: Promise<unknown>) => void;

// Cloudflare Workers extends CacheStorage with a 'default' property
declare const caches: CacheStorage & { default: Cache };

let activeCacheVersion = DEFAULT_CACHE_VERSION;
const pendingJsonFetches = new Map<string, Promise<unknown>>();
const pendingJsonWrites = new Map<string, Promise<void>>();
const pendingTextFetches = new Map<string, Promise<string>>();
const pendingBinaryFetches = new Map<string, Promise<Uint8Array>>();
const pendingResponseFetches = new Map<string, Promise<Response>>();
const pendingResponseRefreshes = new Map<string, { expiresAt: number }>();
const pendingResponseWrites = new Map<string, Promise<void>>();

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

function buildTextCacheResponse(data: string, ttl: number, contentType = 'text/plain'): Response {
  return new Response(data, {
    headers: {
      'Cache-Control': `public, max-age=${ttl}`,
      'Content-Type': contentType,
    },
  });
}

function cloneResponseWithCacheHeaders(response: Response, ttl: number): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${ttl}`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    /** Opt-in only: retain public data for a bounded background refresh window. */
    staleWhileRevalidate?: number;
    shouldCache?: (data: T) => boolean;
  }
): Promise<{ data: T; hit: boolean; stale?: boolean }> {
  const versionedKey = getVersionedCacheKey(cacheKey);
  const staleSeconds = Math.max(0, options?.staleWhileRevalidate ?? 0);
  const request = buildCacheRequest(versionedKey);

  const refresh = (): Promise<T> => {
    const inFlight = pendingJsonFetches.get(versionedKey) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    // Defer execution until the promise has been registered for coalescing.
    const pending = Promise.resolve().then(fetcher).then((data) => {
      let write: Promise<void> = Promise.resolve();
      try {
        // An explicit invalidation also cancels publication of an older refresh.
        if (pendingJsonFetches.get(versionedKey) === pending && (options?.shouldCache?.(data) ?? true)) {
          write = caches.default.put(request, new Response(JSON.stringify(data), {
            headers: {
              'Cache-Control': `public, max-age=${ttl + staleSeconds}`,
              'Content-Type': 'application/json',
              'X-Cache-Fresh-Until': String(Date.now() + ttl * 1000),
            },
          }));
        }
      } catch { /* Cache failures must not fail a successful fetch. */ }
      pendingJsonWrites.set(versionedKey, write);
      const completion = write.catch(() => undefined).finally(() => {
        if (pendingJsonFetches.get(versionedKey) === pending) pendingJsonFetches.delete(versionedKey);
        if (pendingJsonWrites.get(versionedKey) === write) pendingJsonWrites.delete(versionedKey);
      });
      scheduleCacheWrite(completion, options?.waitUntil);
      return data;
    }, (error: unknown) => {
      if (pendingJsonFetches.get(versionedKey) === pending) pendingJsonFetches.delete(versionedKey);
      throw error;
    });
    pendingJsonFetches.set(versionedKey, pending);
    return pending;
  };

  try {
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) {
      const freshUntilHeader = cached.headers.get('X-Cache-Fresh-Until');
      const freshUntil = Number(freshUntilHeader);
      const now = Date.now();
      if (freshUntilHeader === null || (Number.isFinite(freshUntil) && now < freshUntil)) {
        return { data: await cached.json() as T, hit: true };
      }
      if (options?.waitUntil && Number.isFinite(freshUntil) && now < freshUntil + staleSeconds * 1000) {
        const data = await cached.json() as T;
        options.waitUntil(refresh().catch(() => undefined));
        return { data, hit: true, stale: true };
      }
    } else if (staleSeconds === 0) {
      // Retain legacy compatibility for existing callers; SWR uses only its
      // versioned entry so invalidation never revives a legacy stale payload.
      const legacy = await cache.match(buildCacheRequest(cacheKey));
      if (legacy) {
        const promoted = legacy.clone();
        const data = await legacy.json() as T;
        scheduleCacheWrite(cache.put(request, promoted), options?.waitUntil);
        return { data, hit: true };
      }
    }
  } catch { /* Cache unavailable or corrupt: fetch normally. */ }

  return { data: await refresh(), hit: false };
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
      const response = buildTextCacheResponse(data, ttl);
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

export async function peekCachedText(
  cacheKey: string,
  options?: {
    waitUntil?: WaitUntilFn;
    allowLegacyFallback?: boolean;
  }
): Promise<string | null> {
  const versionedKey = getVersionedCacheKey(cacheKey);

  try {
    const cache = caches.default;
    const versionedRequest = buildCacheRequest(versionedKey);
    const legacyRequest = buildCacheRequest(cacheKey);

    const cached = await cache.match(versionedRequest);
    if (cached) {
      return await cached.text();
    }

    if (options?.allowLegacyFallback !== false) {
      const legacyCached = await cache.match(legacyRequest);
      if (legacyCached) {
        const promoted = legacyCached.clone();
        const data = await legacyCached.text();
        scheduleCacheWrite(cache.put(versionedRequest, promoted), options?.waitUntil);
        return data;
      }
    }
  } catch {
    // Cache API not available or error
  }

  return null;
}

/** Read a cached body as a stream, without decoding and re-encoding it. */
export async function peekCachedResponse(
  cacheKey: string,
  options?: { waitUntil?: WaitUntilFn; allowLegacyFallback?: boolean }
): Promise<Response | null> {
  const versionedKey = getVersionedCacheKey(cacheKey);
  try {
    const cache = caches.default;
    const request = buildCacheRequest(versionedKey);
    const cached = await cache.match(request);
    if (cached) return cached;

    if (options?.allowLegacyFallback !== false) {
      const legacy = await cache.match(buildCacheRequest(cacheKey));
      if (legacy) {
        scheduleCacheWrite(cache.put(request, legacy.clone()), options?.waitUntil);
        return legacy;
      }
    }
  } catch {
    // Cache API unavailable or failed; the caller can render normally.
  }
  return null;
}

/** Takes ownership of the response body. Callers must pass a clone if needed. */
export async function putCachedResponse(
  cacheKey: string,
  response: Response,
  ttl: number,
  options?: { waitUntil?: WaitUntilFn }
): Promise<void> {
  // Shared response caches must never persist cookies or error responses.
  if (!response.ok || response.headers.has('set-cookie')) return;
  try {
    scheduleCacheWrite(
      caches.default.put(
        buildCacheRequest(getVersionedCacheKey(cacheKey)),
        cloneResponseWithCacheHeaders(response, ttl)
      ),
      options?.waitUntil
    );
  } catch {
    // Cache API unavailable or failed; never fail the request for a cache write.
  }
}

/**
 * Refresh a public response in its originating request's waitUntil context.
 * Only the reservation is shared across requests: never share response streams
 * or await another request's I/O (which Workers does not allow).
 */
export function refreshCachedResponse(
  cacheKey: string,
  render: () => Promise<Response | null>,
  ttl: number,
  options: { waitUntil: WaitUntilFn }
): void {
  const versionedKey = getVersionedCacheKey(cacheKey);
  const existing = pendingResponseRefreshes.get(versionedKey);
  if (existing && Date.now() < existing.expiresAt) return;
  // Workers may cancel unfinished waitUntil work after 30 seconds. Do not
  // depend on a cancelled task's finally running to release this isolate lock.
  const reservation = { expiresAt: Date.now() + 30_000 };
  pendingResponseRefreshes.set(versionedKey, reservation);
  const refresh = Promise.resolve().then(render).then(async (response) => {
    if (!response) return;
    if (pendingResponseRefreshes.get(versionedKey) !== reservation
      || !response.ok || response.headers.has('set-cookie')) {
      await response.body?.cancel();
      return;
    }
    try {
      const write = caches.default.put(
        buildCacheRequest(versionedKey), cloneResponseWithCacheHeaders(response, ttl)
      );
      pendingResponseWrites.set(versionedKey, write);
      try {
        await write;
      } finally {
        if (pendingResponseWrites.get(versionedKey) === write) pendingResponseWrites.delete(versionedKey);
      }
    } catch { /* A failed refresh must not fail the cached response. */ }
  }).catch(() => {
    // Keep the existing entry until its original expiry when rendering fails.
  }).finally(() => {
    if (pendingResponseRefreshes.get(versionedKey) === reservation) pendingResponseRefreshes.delete(versionedKey);
  });
  options.waitUntil(refresh);
}

export async function putCachedText(
  cacheKey: string,
  data: string,
  ttl: number,
  options?: {
    waitUntil?: WaitUntilFn;
    contentType?: string;
    awaitWrite?: boolean;
  }
): Promise<void> {
  try {
    const cache = caches.default;
    const cacheUrl = buildCacheRequest(getVersionedCacheKey(cacheKey));
    const response = buildTextCacheResponse(data, ttl, options?.contentType);
    const write = cache.put(cacheUrl, response);
    if (options?.awaitWrite) {
      await write;
    } else {
      scheduleCacheWrite(write, options?.waitUntil);
    }
  } catch {
    // Ignore cache write errors
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
 * Get a cached Response while preserving response headers like Content-Type.
 */
export async function getCachedResponse(
  cacheKey: string,
  fetcher: () => Promise<Response>,
  ttl: number,
  options?: {
    waitUntil?: WaitUntilFn;
    shouldCache?: (response: Response) => boolean;
  }
): Promise<{ response: Response; hit: boolean }> {
  const versionedKey = getVersionedCacheKey(cacheKey);

  try {
    const cache = caches.default;
    const versionedRequest = buildCacheRequest(versionedKey);
    const legacyRequest = buildCacheRequest(cacheKey);

    const cached = await cache.match(versionedRequest);
    if (cached) {
      return { response: cached, hit: true };
    }

    const legacyCached = await cache.match(legacyRequest);
    if (legacyCached) {
      const promoted = legacyCached.clone();
      scheduleCacheWrite(cache.put(versionedRequest, promoted), options?.waitUntil);
      return { response: legacyCached, hit: true };
    }
  } catch {
    // Cache API not available or error
  }

  const inFlight = pendingResponseFetches.get(versionedKey);
  if (inFlight) {
    const response = await inFlight;
    return { response: response.clone(), hit: false };
  }

  const shouldCache = options?.shouldCache ?? ((response: Response) => response.ok);

  const fetchPromise = (async (): Promise<Response> => {
    const response = await fetcher();

    if (shouldCache(response)) {
      try {
        const cache = caches.default;
        const cacheUrl = buildCacheRequest(versionedKey);
        scheduleCacheWrite(
          cache.put(cacheUrl, cloneResponseWithCacheHeaders(response.clone(), ttl)),
          options?.waitUntil,
        );
      } catch {
        // Ignore cache write errors.
      }
    }

    return response.clone();
  })();

  pendingResponseFetches.set(versionedKey, fetchPromise);

  try {
    const response = await fetchPromise;
    return { response: response.clone(), hit: false };
  } finally {
    pendingResponseFetches.delete(versionedKey);
  }
}

/**
 * Invalidate a cache entry
 */
export async function invalidateCache(cacheKey: string): Promise<void> {
  const versionedKey = getVersionedCacheKey(cacheKey);
  pendingJsonFetches.delete(versionedKey);
  pendingResponseRefreshes.delete(versionedKey);
  // If publication already started, delete after it finishes rather than
  // letting a slow Cache API write resurrect the invalidated entry.
  await pendingJsonWrites.get(versionedKey)?.catch(() => undefined);
  await pendingResponseWrites.get(versionedKey)?.catch(() => undefined);
  try {
    const cache = caches.default;
    const versionedUrl = buildCacheRequest(versionedKey);
    const legacyUrl = buildCacheRequest(cacheKey);
    await Promise.all([
      cache.delete(versionedUrl),
      cache.delete(legacyUrl),
    ]);
  } catch {
    // Ignore errors
  }
}
