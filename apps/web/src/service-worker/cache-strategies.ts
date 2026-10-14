// Service Worker caching strategy implementations

import {
  CACHE_NAMES,
  IMMUTABLE_CACHE_MAX_ENTRIES,
  STATIC_PATTERNS,
  API_CACHE_CONFIGS,
  PAGE_DATA_CACHE_CONFIGS,
  PUBLIC_ASSET_CACHE_CONFIGS,
  NO_CACHE_PATTERNS,
  type ApiCacheConfig,
} from './cache-config';

// Cache metadata header key
const CACHE_TIME_HEADER = 'sw-cache-time';
const SESSION_COOKIE_PATTERN = /(better-auth|session|auth\.session|session_token)/i;

/**
 * Cache First for static assets.
 * Serve from cache when available, otherwise fetch and cache the response.
 */
type CacheWriteOptions = { waitUntil?: (promise: Promise<unknown>) => void };

function persist(task: Promise<unknown>, options?: CacheWriteOptions): void {
  const guarded = task.catch(() => undefined);
  if (options?.waitUntil) options.waitUntil(guarded);
}

export async function cacheFirst(
  request: Request,
  options?: CacheWriteOptions & { immutable?: boolean }
): Promise<Response> {
  const cache = await caches.open(options?.immutable ? CACHE_NAMES.immutable : CACHE_NAMES.static).catch(() => null);
  const cached = await cache?.match(request).catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && cache) {
    persist(cache.put(request, response.clone()).then(async () => {
      if (!options?.immutable) return;
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - IMMUTABLE_CACHE_MAX_ENTRIES)).map((key) => cache.delete(key)));
    }), options);
  }
  return response;
}

/** Network responses stream immediately; cache storage is not on the response path. */
export async function networkFirst(
  request: Request,
  cacheName: string,
  shouldCacheResponse: (response: Response) => boolean = (response) => response.ok,
  options?: CacheWriteOptions
): Promise<Response> {
  const cachePromise = caches.open(cacheName).catch(() => null);
  let response: Response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cache = await cachePromise;
    const cached = await cache?.match(request).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
  // Keep eviction synchronous when a response is no longer public.
  if (response.ok && !shouldCacheResponse(response)) {
    const cache = await cachePromise;
    await cache?.delete(request).catch(() => undefined);
  } else if (response.ok) {
    const copy = response.clone();
    persist(cachePromise.then(async (cache) => {
      if (cache) await cache.put(request, copy);
    }), options);
  }
  return response;
}

/**
 * Stale While Revalidate for cacheable API responses.
 * Return cached data immediately when possible and refresh in the background.
 */
export async function staleWhileRevalidate(
  request: Request,
  config: ApiCacheConfig,
  options?: {
    cacheName?: string;
    shouldCacheResponse?: (response: Response) => boolean;
    waitUntil?: (promise: Promise<unknown>) => void;
  }
): Promise<Response> {
  const cache = await caches.open(options?.cacheName || CACHE_NAMES.api).catch(() => null);
  const cached = await cache?.match(request).catch(() => undefined);

  const now = Date.now();
  const shouldCacheResponse = options?.shouldCacheResponse ?? ((response: Response) => response.ok);

  // Background refresh function
  const updateCache = async () => {
    try {
      const response = await fetch(request);
      if (response.ok && shouldCacheResponse(response)) {
        // Persist the cache timestamp on the stored response
        const headers = new Headers(response.headers);
        headers.set(CACHE_TIME_HEADER, now.toString());

        const cachedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });

        await cache?.put(request, cachedResponse);
      } else if (response.ok) {
        await cache?.delete(request);
      }
    } catch {
      // Silently ignore refresh failures
    }
  };

  if (cached) {
    const cacheTime = parseInt(cached.headers.get(CACHE_TIME_HEADER) || '0', 10);
    const age = now - cacheTime;

    // Cache entry is still fresh
    if (age < config.maxAge) {
      return cached;
    }

    // Cache entry is stale but still within the stale-while-revalidate window
    if (age < config.maxAge + config.staleWhileRevalidate) {
      const refresh = updateCache();
      if (options?.waitUntil) {
        options.waitUntil(refresh);
      } else {
        void refresh;
      }
      return cached;
    }
  }

  // No cache or fully expired cache: wait for the network response
  const response = await fetch(request);

  if (response.ok && shouldCacheResponse(response)) {
    const headers = new Headers(response.headers);
    headers.set(CACHE_TIME_HEADER, now.toString());

    const cachedResponse = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    if (cache) persist(cache.put(request, cachedResponse), options);
  } else if (response.ok && cache) {
    await cache.delete(request).catch(() => undefined);
  }

  return response;
}

/**
 * Check whether a request targets a static asset.
 */
export function isStaticAsset(url: URL): boolean {
  const fullUrl = url.href;
  const pathname = url.pathname;

  return STATIC_PATTERNS.some((pattern) => {
    if (pattern.source.startsWith('^https')) {
      return pattern.test(fullUrl);
    }
    return pattern.test(pathname);
  });
}

/**
 * Check whether a request is a top-level navigation.
 */
export function isNavigationRequest(request: Request): boolean {
  return request.mode === 'navigate';
}

/**
 * Check whether a request is a SvelteKit page data request.
 * Examples: /foo/__data.json or /__data.json
 */
export function isSvelteKitDataRequest(url: URL): boolean {
  return url.pathname === '/__data.json' || url.pathname.endsWith('/__data.json');
}

/**
 * Detect authenticated requests so the SW can avoid replaying anonymous page caches.
 */
export function hasSessionCookie(request: Request): boolean {
  return SESSION_COOKIE_PATTERN.test(request.headers.get('cookie') ?? '');
}

/**
 * Detect credentials that can make same-origin API and page responses user-specific.
 */
export function hasAuthCredentials(request: Request): boolean {
  return Boolean(request.headers.get('authorization')) || hasSessionCookie(request);
}

/**
 * Cache only page responses explicitly marked as public.
 * This avoids storing personalized or private responses.
 */
export function isExplicitlyPublicResponse(response: Response): boolean {
  if (!response.ok) {
    return false;
  }

  const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
  if (!cacheControl) {
    return false;
  }

  if (
    cacheControl.includes('no-store')
    || cacheControl.includes('private')
    || cacheControl.includes('no-cache')
  ) {
    return false;
  }

  const vary = response.headers.get('vary')?.toLowerCase() ?? '';
  if (vary.includes('*') || vary.includes('cookie')) {
    return false;
  }

  return cacheControl.includes('public');
}

/**
 * Resolve API cache configuration for a pathname.
 */
export function getApiCacheConfig(pathname: string): ApiCacheConfig | null {
  // Exclude routes that must never be cached
  if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return null;
  }

  // Find the first matching cache config
  return API_CACHE_CONFIGS.find((config) => config.test(pathname)) || null;
}

export function getPageDataCacheConfig(pathname: string): ApiCacheConfig | null {
  return PAGE_DATA_CACHE_CONFIGS.find((config) => config.test(pathname)) || null;
}

export function getPublicAssetCacheConfig(pathname: string): ApiCacheConfig | null {
  return PUBLIC_ASSET_CACHE_CONFIGS.find((config) => config.test(pathname)) || null;
}

/**
 * Remove caches from older SW versions.
 */
export async function cleanupOldCaches(): Promise<void> {
  const cacheNames = await caches.keys();
  const currentCaches = new Set<string>(Object.values(CACHE_NAMES));

  await Promise.all(
    cacheNames
      .filter((name) => name.startsWith('skillscat-') && !currentCaches.has(name))
      .map((name) => caches.delete(name))
  );
}
