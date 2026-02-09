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
 * - Anonymous + no cookies: edge-cacheable
 * - Logged-in or cookie-bearing requests: no-store (avoid personalized HTML caching)
 */
export function setPublicPageCache({
  setHeaders,
  request,
  isAuthenticated,
  hasCookies = false,
  sMaxAge,
  staleWhileRevalidate,
}: PageCacheOptions): void {
  if (isAuthenticated || hasCookies || Boolean(request.headers.get('cookie'))) {
    setHeaders({
      'Cache-Control': 'private, no-store',
    });
    return;
  }

  setHeaders({
    'Cache-Control': `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  });
}
