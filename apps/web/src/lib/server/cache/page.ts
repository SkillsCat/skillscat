import { LOCALE_COOKIE_NAME } from '$lib/i18n/config';

interface PageCacheOptions {
  setHeaders: (headers: Record<string, string>) => void;
  request: Request;
  isAuthenticated: boolean;
  sMaxAge: number;
  staleWhileRevalidate: number;
  varyByLanguageHeader?: boolean;
  varyByCookie?: boolean;
}

/**
 * Apply HTML caching policy for public pages:
 * - Logged-in requests with auth-sensitive SSR shell: private browser-cacheable
 * - Public pages with auth-independent shell: shared-cacheable and may opt out of Cookie vary
 */
export function setPublicPageCache({
  setHeaders,
  request,
  isAuthenticated,
  sMaxAge,
  staleWhileRevalidate,
  varyByLanguageHeader = true,
  varyByCookie = true,
}: PageCacheOptions): void {
  if (isAuthenticated) {
    setHeaders({
      // Allow short-lived browser caching for logged-in navigation while preventing shared edge caching.
      'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      Vary: 'Cookie',
    });
    return;
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const hasLocaleCookie = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=`).test(cookieHeader);
  const varyValues: string[] = [];

  if (varyByCookie) {
    varyValues.push('Cookie');
  }

  // Indexable public pages intentionally collapse to the default locale unless the user
  // has chosen a locale explicitly, so they don't need an Accept-Language vary.
  if (varyByLanguageHeader && !hasLocaleCookie) {
    varyValues.push('Accept-Language');
  }

  const headers: Record<string, string> = {
    'Cache-Control': `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  };

  if (varyValues.length > 0) {
    headers.Vary = varyValues.join(', ');
  }

  setHeaders(headers);
}
