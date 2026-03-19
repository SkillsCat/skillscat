import type { RequestHandler } from './$types';
import {
  normalizeSitemapRefreshMinIntervalSeconds,
  SITEMAP_INDEX_CACHE_CONTROL,
  SITEMAP_INDEX_CACHE_TTL,
  buildSitemapIndexEntries,
  buildSitemapIndexXml,
  createCachedSitemapResponse,
  getSitemapIndexStats,
} from '$lib/server/seo/sitemap';

export const GET: RequestHandler = async ({ platform }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const snapshotMaxAgeSeconds = normalizeSitemapRefreshMinIntervalSeconds(
    platform?.env?.SITEMAP_REFRESH_MIN_INTERVAL_SECONDS
  );

  return createCachedSitemapResponse({
    cacheKey: 'sitemap:index:xml',
    ttl: SITEMAP_INDEX_CACHE_TTL,
    cacheControl: SITEMAP_INDEX_CACHE_CONTROL,
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
