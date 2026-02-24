// Service Worker caching strategy implementations

import {
  CACHE_NAMES,
  STATIC_PATTERNS,
  API_CACHE_CONFIGS,
  NO_CACHE_PATTERNS,
  type ApiCacheConfig,
} from './cache-config';

// Cache metadata header key
const CACHE_TIME_HEADER = 'sw-cache-time';

/**
 * Cache First for static assets.
 * Serve from cache when available, otherwise fetch and cache the response.
 */
export async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAMES.static);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  if (response.ok) {
    cache.put(request, response.clone());
  }

  return response;
}

/**
 * Network First for HTML documents and SvelteKit data requests.
 * Prefer fresh network responses and fall back to cache when offline.
 */
export async function networkFirst(
  request: Request,
  cacheName: string,
  shouldCacheResponse: (response: Response) => boolean = (response) => response.ok
): Promise<Response> {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    // Only update or clear cache on successful responses to avoid caching error pages.
    if (response.ok) {
      if (shouldCacheResponse(response)) {
        await cache.put(request, response.clone());
      } else {
        await cache.delete(request);
      }
    }

    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

/**
 * Stale While Revalidate for cacheable API responses.
 * Return cached data immediately when possible and refresh in the background.
 */
export async function staleWhileRevalidate(
  request: Request,
  config: ApiCacheConfig
): Promise<Response> {
  const cache = await caches.open(CACHE_NAMES.api);
  const cached = await cache.match(request);

  const now = Date.now();

  // Background refresh function
  const updateCache = async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        // Persist the cache timestamp on the stored response
        const headers = new Headers(response.headers);
        headers.set(CACHE_TIME_HEADER, now.toString());

        const cachedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });

        await cache.put(request, cachedResponse);
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
      updateCache();
      return cached;
    }
  }

  // No cache or fully expired cache: wait for the network response
  const response = await fetch(request);

  if (response.ok) {
    const headers = new Headers(response.headers);
    headers.set(CACHE_TIME_HEADER, now.toString());

    const cachedResponse = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    cache.put(request, cachedResponse);
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

/**
 * Remove caches from older SW versions.
 */
export async function cleanupOldCaches(): Promise<void> {
  const cacheNames = await caches.keys();
  const currentCaches = new Set<string>(Object.values(CACHE_NAMES));

  await Promise.all(
    cacheNames
      .filter((name) => !currentCaches.has(name))
      .map((name) => caches.delete(name))
  );
}
