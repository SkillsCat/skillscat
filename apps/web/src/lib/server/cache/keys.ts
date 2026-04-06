import { LOCALES, type SupportedLocale } from '$lib/i18n/config';

export const HOME_CRITICAL_CACHE_KEY = 'page:home:critical:v1';
export const HOME_RECENT_CACHE_KEY = 'page:home:recent:v1';
export const HOME_TOP_CACHE_KEY = 'page:home:top:v1';
export const LEGACY_HOME_CACHE_KEY = 'page:home:v1';
export const HOME_HTML_CACHE_KEY_PREFIX = 'page:home:html:v1';
export const DISCOVERY_HTML_CACHE_KEY_PREFIX = 'page:discovery:html:v1';
export const SKILL_HTML_CACHE_KEY_PREFIX = 'page:skill:html:v1';
export const SKILL_PUBLIC_HINT_CACHE_KEY_PREFIX = 'page:skill:public:v1';
export const PUBLIC_SKILLS_STATS_CACHE_KEY = 'stats:public-skills:v1';

export function getHomeHtmlCacheKey(locale: SupportedLocale): string {
  return `${HOME_HTML_CACHE_KEY_PREFIX}:${locale}`;
}

function encodeCacheKeySegment(value: string): string {
  return encodeURIComponent(value);
}

export type DiscoveryHtmlCacheKind = 'trending' | 'recent' | 'top' | 'categories';

export function getDiscoveryHtmlCacheKey(
  locale: SupportedLocale,
  kind: DiscoveryHtmlCacheKind
): string {
  return `${DISCOVERY_HTML_CACHE_KEY_PREFIX}:${kind}:${locale}`;
}

export function getCategoryHtmlCacheKey(locale: SupportedLocale, categorySlug: string): string {
  return `${DISCOVERY_HTML_CACHE_KEY_PREFIX}:category:${locale}:${encodeCacheKeySegment(categorySlug)}`;
}

function getDiscoveryHtmlCacheKeys(kind: DiscoveryHtmlCacheKind): string[] {
  return LOCALES.map((locale) => getDiscoveryHtmlCacheKey(locale, kind));
}

export function getCategoryHtmlCacheKeys(categorySlug: string): string[] {
  return LOCALES.map((locale) => getCategoryHtmlCacheKey(locale, categorySlug));
}

export function getSkillHtmlCacheKey(locale: SupportedLocale, slug: string): string {
  return `${SKILL_HTML_CACHE_KEY_PREFIX}:${locale}:${encodeCacheKeySegment(slug)}`;
}

export function getSkillHtmlCacheKeys(slug: string): string[] {
  return LOCALES.map((locale) => getSkillHtmlCacheKey(locale, slug));
}

export function getSkillPublicHintCacheKey(slug: string): string {
  return `${SKILL_PUBLIC_HINT_CACHE_KEY_PREFIX}:${encodeCacheKeySegment(slug)}`;
}

export function getSkillPageCacheInvalidationKeys(slug: string): string[] {
  return [
    getSkillPublicHintCacheKey(slug),
    ...getSkillHtmlCacheKeys(slug),
  ];
}

export const HOME_HTML_CACHE_KEYS = LOCALES.map((locale) => getHomeHtmlCacheKey(locale));
export const TRENDING_HTML_CACHE_KEYS = getDiscoveryHtmlCacheKeys('trending');
export const RECENT_HTML_CACHE_KEYS = getDiscoveryHtmlCacheKeys('recent');
export const TOP_HTML_CACHE_KEYS = getDiscoveryHtmlCacheKeys('top');
export const CATEGORIES_HTML_CACHE_KEYS = getDiscoveryHtmlCacheKeys('categories');

export const PUBLIC_DISCOVERY_PAGE_CACHE_KEYS = [
  HOME_CRITICAL_CACHE_KEY,
  HOME_RECENT_CACHE_KEY,
  HOME_TOP_CACHE_KEY,
  ...HOME_HTML_CACHE_KEYS,
  ...TRENDING_HTML_CACHE_KEYS,
  ...RECENT_HTML_CACHE_KEYS,
  ...TOP_HTML_CACHE_KEYS,
  ...CATEGORIES_HTML_CACHE_KEYS,
  PUBLIC_SKILLS_STATS_CACHE_KEY,
  'api:categories',
  'page:trending:v1:1',
  'page:recent:v1:1',
  'page:top:v1:1',
  'page:categories:v1',
] as const;

export const PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS = [
  LEGACY_HOME_CACHE_KEY,
  ...PUBLIC_DISCOVERY_PAGE_CACHE_KEYS,
] as const;
