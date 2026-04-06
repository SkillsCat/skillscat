import type { RequestHandler } from './$types';
import {
  buildSitemapCacheControl,
  normalizeSitemapRefreshMinIntervalSeconds,
  SITEMAP_INDEX_CACHE_TTL,
  SITEMAP_INDEX_BROWSER_MAX_AGE_SECONDS,
  SITEMAP_INDEX_SHARED_MAX_AGE_SECONDS,
  SITEMAP_INDEX_STALE_WHILE_REVALIDATE_SECONDS,
  buildSitemapIndexEntries,
  buildSitemapIndexXml,
  createCachedSitemapResponse,
  getSitemapHotCacheTtlSeconds,
  getSitemapSharedMaxAgeSeconds,
  getSitemapIndexStats,
} from '$lib/server/seo/sitemap';

export const GET: RequestHandler = async ({ platform }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const refreshMinIntervalSeconds = normalizeSitemapRefreshMinIntervalSeconds(
    platform?.env?.SITEMAP_REFRESH_MIN_INTERVAL_SECONDS
  );
  const snapshotMaxAgeSeconds = refreshMinIntervalSeconds;

  return createCachedSitemapResponse({
    cacheKey: 'sitemap:index:xml',
    ttl: getSitemapHotCacheTtlSeconds(SITEMAP_INDEX_CACHE_TTL, refreshMinIntervalSeconds),
    cacheControl: buildSitemapCacheControl({
      browserMaxAgeSeconds: SITEMAP_INDEX_BROWSER_MAX_AGE_SECONDS,
      sharedMaxAgeSeconds: getSitemapSharedMaxAgeSeconds(
        SITEMAP_INDEX_SHARED_MAX_AGE_SECONDS,
        refreshMinIntervalSeconds
      ),
      staleWhileRevalidateSeconds: SITEMAP_INDEX_STALE_WHILE_REVALIDATE_SECONDS,
    }),
    debugTag: 'index',
    r2,
    snapshotMaxAgeSeconds,
    waitUntil,
    fetcher: async () => {
      const stats = await getSitemapIndexStats(db);
      return buildSitemapIndexXml(buildSitemapIndexEntries(stats));
    },
  });
};

export const HEAD = GET;
