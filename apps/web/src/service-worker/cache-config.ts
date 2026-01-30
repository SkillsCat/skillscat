// Service Worker 缓存配置

// 版本号 - 构建时会被替换
export const SW_VERSION = '__SW_VERSION__';

// 缓存名称
export const CACHE_NAMES = {
  static: `skillscat-static-v${SW_VERSION}`,
  api: `skillscat-api-v${SW_VERSION}`,
} as const;

// 静态资源匹配模式 (Cache First)
export const STATIC_PATTERNS: RegExp[] = [
  /^\/_app\/immutable\//,
  /\.(?:js|css|woff2?|ttf|otf)$/,
  /\.(?:png|jpg|jpeg|webp|svg|gif|ico)$/,
  /^https:\/\/avatars\.githubusercontent\.com\//,
];

// API 缓存配置 (Stale While Revalidate)
export interface ApiCacheConfig {
  pattern: RegExp;
  maxAge: number; // 缓存时间 (ms)
  staleWhileRevalidate: number; // 过期验证时间 (ms)
}

// 创建带 test 方法的配置
function createConfig(
  pattern: RegExp,
  maxAge: number,
  staleWhileRevalidate: number
): ApiCacheConfig & { test: (s: string) => boolean } {
  return {
    pattern,
    maxAge,
    staleWhileRevalidate,
    test: (s: string) => pattern.test(s),
  };
}

export const API_CACHE_CONFIGS = [
  createConfig(/^\/api\/categories$/, 5 * 60 * 1000, 10 * 60 * 1000),
  createConfig(/^\/api\/skills$/, 1 * 60 * 1000, 2 * 60 * 1000),
  createConfig(/^\/api\/skills\/[^/]+$/, 5 * 60 * 1000, 10 * 60 * 1000),
  createConfig(/^\/api\/skills\/[^/]+\/files$/, 5 * 60 * 1000, 10 * 60 * 1000),
  createConfig(/^\/api\/skills\/[^/]+\/download$/, 60 * 60 * 1000, 2 * 60 * 60 * 1000),
  createConfig(/^\/api\/search/, 1 * 60 * 1000, 2 * 60 * 1000),
  createConfig(/^\/api\/registry\/search/, 1 * 60 * 1000, 2 * 60 * 1000),
  createConfig(/^\/api\/registry\/skill\//, 5 * 60 * 1000, 10 * 60 * 1000),
];

// 不缓存的路由模式
export const NO_CACHE_PATTERNS: RegExp[] = [
  /^\/api\/auth\//,
  /^\/api\/favorites/,
  /^\/api\/tokens/,
  /^\/api\/device\//,
  /^\/api\/admin\//,
  /^\/api\/orgs\//,
  /^\/api\/submit/,
];
