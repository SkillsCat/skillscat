// Service Worker cache configuration

// Version placeholder replaced during the SW build step
declare const __SW_VERSION__: string;
export const SW_VERSION = __SW_VERSION__;

// Cache names
export const CACHE_NAMES = {
  static: `skillscat-static-v${SW_VERSION}`,
  api: `skillscat-api-v${SW_VERSION}`,
  pages: `skillscat-pages-v${SW_VERSION}`,
  pageData: `skillscat-page-data-v${SW_VERSION}`,
  publicAssets: `skillscat-public-assets-v${SW_VERSION}`,
} as const;

// Static asset match patterns (Cache First)
export const STATIC_PATTERNS: RegExp[] = [
  /^\/_app\/immutable\//,
  /\.(?:js|css|woff2?|ttf|otf)$/,
  /\.(?:png|jpg|jpeg|webp|svg|gif|ico)$/,
  /^https:\/\/avatars\.githubusercontent\.com\//,
];

// API cache configuration (Stale While Revalidate)
export interface ApiCacheConfig {
  pattern: RegExp;
  maxAge: number; // Cache freshness window (ms)
  staleWhileRevalidate: number; // Stale serving window after maxAge (ms)
}

// Helper to attach a typed test function to each config entry
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
  createConfig(/^\/api\/skills\/.+\/recommend$/, 30 * 60 * 1000, 24 * 60 * 60 * 1000),
  createConfig(/^\/api\/skills\/[^/]+\/files$/, 5 * 60 * 1000, 10 * 60 * 1000),
  createConfig(/^\/api\/skills\/[^/]+\/download$/, 60 * 60 * 1000, 2 * 60 * 60 * 1000),
  createConfig(/^\/api\/search/, 30 * 1000, 90 * 1000),
  createConfig(/^\/api\/registry\/search/, 30 * 1000, 90 * 1000),
  createConfig(/^\/api\/registry\/skill\//, 5 * 60 * 1000, 10 * 60 * 1000),
];

export const PAGE_DATA_CACHE_CONFIGS = [
  createConfig(/^\/skills\/.+\/__data\.json$/, 2 * 60 * 1000, 15 * 60 * 1000),
];

export const PUBLIC_ASSET_CACHE_CONFIGS = [
  createConfig(/^\/avatar$/, 7 * 24 * 60 * 60 * 1000, 30 * 24 * 60 * 60 * 1000),
] as const;

// Route patterns that must never be cached by the SW
export const NO_CACHE_PATTERNS: RegExp[] = [
  /^\/api\/auth\//,
  /^\/api\/favorites/,
  /^\/api\/tokens/,
  /^\/api\/device\//,
  /^\/api\/admin\//,
  /^\/api\/orgs\//,
  /^\/api\/submit/,
];
