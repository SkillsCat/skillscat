import type { SupportedLocale } from '$lib/i18n/config';
import {
  getCategoryHtmlCacheKey,
  getDiscoveryHtmlCacheKey,
} from '$lib/server/cache/keys';

interface PublicDiscoveryHtmlCacheInput {
  routeId: string | null;
  locale: SupportedLocale;
  searchParams: URLSearchParams;
  params?: {
    slug?: string;
  };
}

function parsePage(raw: string | null): number {
  const parsed = Number.parseInt(raw || '1', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

export function getPublicDiscoveryHtmlCacheKey(
  input: PublicDiscoveryHtmlCacheInput
): string | null {
  switch (input.routeId) {
    case '/trending':
      return parsePage(input.searchParams.get('page')) === 1
        ? getDiscoveryHtmlCacheKey(input.locale, 'trending')
        : null;
    case '/recent':
      return parsePage(input.searchParams.get('page')) === 1
        ? getDiscoveryHtmlCacheKey(input.locale, 'recent')
        : null;
    case '/top':
      return parsePage(input.searchParams.get('page')) === 1
        ? getDiscoveryHtmlCacheKey(input.locale, 'top')
        : null;
    case '/categories':
      return getDiscoveryHtmlCacheKey(input.locale, 'categories');
    case '/category/[slug]': {
      const slug = input.params?.slug?.trim();
      return slug && parsePage(input.searchParams.get('page')) === 1
        ? getCategoryHtmlCacheKey(input.locale, slug)
        : null;
    }
    default:
      return null;
  }
}
