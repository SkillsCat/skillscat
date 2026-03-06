import { LOCALE_COOKIE_NAME } from '$lib/i18n/config';

interface PageCacheOptions {
  setHeaders: (headers: Record<string, string>) => void;
  request: Request;
  isAuthenticated: boolean;
  hasCookies?: boolean;
  sMaxAge: number;
  staleWhileRevalidate: number;
}

/**
 * Apply conservative HTML caching for public pages:
 * - Anonymous requests: edge-cacheable (cookies alone don't imply personalization)
 * - Logged-in requests: private browser-cacheable (never shared-cache)
 */
export function setPublicPageCache({
  setHeaders,
  request,
  isAuthenticated,
  hasCookies = false,
  sMaxAge,
  staleWhileRevalidate,
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

  setHeaders({
    'Cache-Control': `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    Vary: hasLocaleCookie ? 'Cookie' : 'Accept-Language',
  });
}
