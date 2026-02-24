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
  getApiCacheConfig,
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

  // Page navigations: Network First (cache only explicitly public responses)
  if (isSameOrigin && isNavigationRequest(request)) {
    event.respondWith(
      networkFirst(request, CACHE_NAMES.pages, isExplicitlyPublicResponse)
    );
    return;
  }

  // SvelteKit page data (__data.json): Network First with offline fallback
  if (isSameOrigin && isSvelteKitDataRequest(url)) {
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
      event.respondWith(staleWhileRevalidate(request, config));
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
