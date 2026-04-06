// Service Worker entry point

import { SW_VERSION, CACHE_NAMES } from './cache-config';
import {
  cacheFirst,
  networkFirst,
  staleWhileRevalidate,
  isStaticAsset,
  isNavigationRequest,
  isSvelteKitDataRequest,
  isExplicitlyPublicResponse,
  hasSessionCookie,
  getApiCacheConfig,
  getPageDataCacheConfig,
  getPublicAssetCacheConfig,
  cleanupOldCaches,
} from './cache-strategies';

declare const self: ServiceWorkerGlobalScope;

// Install event: skip waiting and activate as soon as possible
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${SW_VERSION}`);
  event.waitUntil(self.skipWaiting());
});

// Activate event: clean old caches and take control of existing clients
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${SW_VERSION}`);
  event.waitUntil(
    Promise.all([cleanupOldCaches(), self.clients.claim()])
  );
});

// Fetch event: intercept requests and apply cache strategies
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Ignore non-HTTP(S) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isAuthenticatedDocumentRequest = isSameOrigin
    && hasSessionCookie(request)
    && (isNavigationRequest(request) || isSvelteKitDataRequest(url));

  if (isAuthenticatedDocumentRequest) {
    // Authenticated page shells and __data.json can differ from the anonymous version,
    // so bypass both the browser HTTP cache and the SW page caches.
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Public avatar proxy: aggressively reuse in-browser cache to avoid repeat Worker hits.
  if (isSameOrigin) {
    const assetConfig = getPublicAssetCacheConfig(url.pathname);
    if (assetConfig) {
      event.respondWith(
        staleWhileRevalidate(request, assetConfig, {
          cacheName: CACHE_NAMES.publicAssets,
          waitUntil: event.waitUntil.bind(event),
        })
      );
      return;
    }
  }

  // Page navigations: Network First (cache only explicitly public responses)
  if (isSameOrigin && isNavigationRequest(request)) {
    event.respondWith(
      networkFirst(request, CACHE_NAMES.pages, isExplicitlyPublicResponse)
    );
    return;
  }

  // SvelteKit page data (__data.json): Network First with offline fallback
  if (isSameOrigin && isSvelteKitDataRequest(url)) {
    const pageDataConfig = getPageDataCacheConfig(url.pathname);
    if (pageDataConfig) {
      event.respondWith(
        staleWhileRevalidate(request, pageDataConfig, {
          cacheName: CACHE_NAMES.pageData,
          shouldCacheResponse: isExplicitlyPublicResponse,
          waitUntil: event.waitUntil.bind(event),
        })
      );
      return;
    }

    event.respondWith(
      networkFirst(request, CACHE_NAMES.pageData, isExplicitlyPublicResponse)
    );
    return;
  }

  // Static assets: Cache First
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // API requests: Stale While Revalidate
  if (url.pathname.startsWith('/api/')) {
    const config = getApiCacheConfig(url.pathname);

    if (config) {
      event.respondWith(staleWhileRevalidate(request, config, {
        waitUntil: event.waitUntil.bind(event),
      }));
      return;
    }
  }

  // All other requests fall through to the network
});

// Message event: support manual cache management
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))))
    );
  }

  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }
});
