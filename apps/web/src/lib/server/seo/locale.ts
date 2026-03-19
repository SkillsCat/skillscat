import { shouldNoIndexPath } from '$lib/server/security/request';

const INDEXABLE_PAGE_METHODS = new Set(['GET', 'HEAD']);

const NON_HTML_PREFIXES = [
  '/api/',
  '/registry/',
  '/openclaw/api/',
  '/sitemaps/',
  '/.well-known/',
];

const NON_HTML_EXACT_PATHS = new Set([
  '/mcp',
  '/sitemap.xml',
  '/llm.txt',
  '/marketplace.json',
]);

const ENGLISH_ONLY_PUBLIC_PATHS = new Set([
  '/docs',
  '/docs/cli',
  '/docs/openclaw',
]);

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '') || '/';
}

export function shouldUseDefaultLocaleForIndexablePage(pathname: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const normalizedPathname = normalizePathname(pathname);
  if (!INDEXABLE_PAGE_METHODS.has(normalizedMethod)) {
    return false;
  }

  if (shouldNoIndexPath(normalizedPathname)) {
    return false;
  }

  if (NON_HTML_EXACT_PATHS.has(normalizedPathname)) {
    return false;
  }

  if (NON_HTML_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))) {
    return false;
  }

  return true;
}

export function shouldForceDefaultLocaleForPublicPage(pathname: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (!INDEXABLE_PAGE_METHODS.has(normalizedMethod)) {
    return false;
  }

  return ENGLISH_ONLY_PUBLIC_PATHS.has(normalizePathname(pathname));
}
