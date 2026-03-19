import { LOCALE_COOKIE_NAME } from '$lib/i18n/config';

interface PageCacheOptions {
  setHeaders: (headers: Record<string, string>) => void;
  request: Request;
  isAuthenticated: boolean;
  sMaxAge: number;
  staleWhileRevalidate: number;
  varyByLanguageHeader?: boolean;
}

/**
 * Apply conservative HTML caching for public pages:
 * - Anonymous requests: edge-cacheable, but cookie-varied because the root layout
 *   still includes auth-sensitive shell state (for example the navbar session state)
 * - Logged-in requests: private browser-cacheable (never shared-cache)
 */
export function setPublicPageCache({
  setHeaders,
  request,
  isAuthenticated,
  sMaxAge,
  staleWhileRevalidate,
  varyByLanguageHeader = true,
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
  const varyValues = ['Cookie'];

  // Indexable public pages intentionally collapse to the default locale unless the user
  // has chosen a locale explicitly, so they don't need an Accept-Language vary.
  if (varyByLanguageHeader && !hasLocaleCookie) {
    varyValues.push('Accept-Language');
  }

  setHeaders({
    'Cache-Control': `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    Vary: varyValues.join(', '),
  });
}
