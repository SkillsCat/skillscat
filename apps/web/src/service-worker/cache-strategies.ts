// Service Worker 缓存策略实现

import {
  CACHE_NAMES,
  STATIC_PATTERNS,
  API_CACHE_CONFIGS,
  NO_CACHE_PATTERNS,
  type ApiCacheConfig,
} from './cache-config';

// 缓存元数据 key
const CACHE_TIME_HEADER = 'sw-cache-time';

/**
 * Cache First 策略 - 用于静态资源
 * 优先从缓存读取，缓存未命中时从网络获取并缓存
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
 * Stale While Revalidate 策略 - 用于 API 响应
 * 立即返回缓存（如果有），同时在后台更新缓存
 */
export async function staleWhileRevalidate(
  request: Request,
  config: ApiCacheConfig
): Promise<Response> {
  const cache = await caches.open(CACHE_NAMES.api);
  const cached = await cache.match(request);

  const now = Date.now();

  // 后台更新函数
  const updateCache = async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        // 添加缓存时间戳
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
      // 网络错误时静默失败
    }
  };

  if (cached) {
    const cacheTime = parseInt(cached.headers.get(CACHE_TIME_HEADER) || '0', 10);
    const age = now - cacheTime;

    // 缓存仍然新鲜
    if (age < config.maxAge) {
      return cached;
    }

    // 缓存过期但在 stale 窗口内，返回缓存并后台更新
    if (age < config.maxAge + config.staleWhileRevalidate) {
      updateCache();
      return cached;
    }
  }

  // 无缓存或缓存完全过期，等待网络响应
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
 * 判断请求是否为静态资源
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
 * 获取 API 缓存配置
 */
export function getApiCacheConfig(pathname: string): ApiCacheConfig | null {
  // 检查是否在不缓存列表中
  if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return null;
  }

  // 查找匹配的缓存配置
  return API_CACHE_CONFIGS.find((config) => config.test(pathname)) || null;
}

/**
 * 清理旧版本缓存
 */
export async function cleanupOldCaches(): Promise<void> {
  const cacheNames = await caches.keys();
  const currentCaches = Object.values(CACHE_NAMES);

  await Promise.all(
    cacheNames
      .filter((name) => !currentCaches.includes(name))
      .map((name) => caches.delete(name))
  );
}
