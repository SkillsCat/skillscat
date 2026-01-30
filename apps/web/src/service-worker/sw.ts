// Service Worker 主入口

import { SW_VERSION } from './cache-config';
import {
  cacheFirst,
  staleWhileRevalidate,
  isStaticAsset,
  getApiCacheConfig,
  cleanupOldCaches,
} from './cache-strategies';

declare const self: ServiceWorkerGlobalScope;

// Install 事件 - 跳过等待，立即激活
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${SW_VERSION}`);
  event.waitUntil(self.skipWaiting());
});

// Activate 事件 - 清理旧缓存，接管所有客户端
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${SW_VERSION}`);
  event.waitUntil(
    Promise.all([cleanupOldCaches(), self.clients.claim()])
  );
});

// Fetch 事件 - 拦截请求并应用缓存策略
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 只处理 GET 请求
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 跳过非 HTTP(S) 请求
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 静态资源 - Cache First
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // API 请求 - Stale While Revalidate
  if (url.pathname.startsWith('/api/')) {
    const config = getApiCacheConfig(url.pathname);

    if (config) {
      event.respondWith(staleWhileRevalidate(request, config));
      return;
    }
  }

  // 其他请求 - 直接网络请求
});

// Message 事件 - 支持手动清除缓存
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
