/** Metadata stays in Cache API, never in the browser's response. */
export const HTML_BUILD_HEADER = 'X-Skillscat-Html-Build';
const REFRESH_AFTER_HEADER = 'X-Skillscat-Html-Refresh-After';
const EXPIRES_HEADER = 'X-Skillscat-Html-Expires';

export type PublicHtmlCacheStatus = 'HIT' | 'STALE' | 'MISS';

export function getPublicHtmlCacheStatus(response: Response, build: string): PublicHtmlCacheStatus {
  if (response.headers.get(HTML_BUILD_HEADER) !== build) return 'MISS';
  const refreshAfter = response.headers.get(REFRESH_AFTER_HEADER);
  const expires = response.headers.get(EXPIRES_HEADER);
  // Entries from the same build without refresh metadata retain their original
  // Cache API expiry; they cannot opt into the background refresh path.
  if (refreshAfter === null && expires === null) return 'HIT';
  const now = Date.now();
  if (!refreshAfter || !expires || !Number.isFinite(Number(refreshAfter))
    || !Number.isFinite(Number(expires)) || now >= Number(expires)) return 'MISS';
  return now >= Number(refreshAfter) ? 'STALE' : 'HIT';
}

/** Takes ownership of the stream. Error/personalized responses are never stored. */
export function createPublicHtmlCacheResponse(
  response: Response,
  build: string,
  ttlSeconds: number
): Response | null {
  if (response.status !== 200
    || !(response.headers.get('content-type') || '').includes('text/html')
    || response.headers.has('set-cookie')
    || response.headers.has('X-Skillscat-Status-Override')
    || /(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get('cache-control') || '')) {
    void response.body?.cancel().catch(() => undefined);
    return null;
  }
  const now = Date.now();
  // Refresh during the final 10% of the EXISTING TTL (at most 30 seconds).
  // Never extend the stale visibility/content window beyond the old policy.
  const refreshWindow = Math.min(30, ttlSeconds * 0.1);
  return new Response(response.body, {
    headers: {
      'Content-Type': response.headers.get('content-type')!,
      [HTML_BUILD_HEADER]: build,
      [REFRESH_AFTER_HEADER]: String(now + (ttlSeconds - refreshWindow) * 1000),
      [EXPIRES_HEADER]: String(now + ttlSeconds * 1000),
    },
  });
}
