import type { RequestHandler } from './$types';
import {
  SITEMAP_INDEX_CACHE_CONTROL,
  SITEMAP_INDEX_CACHE_TTL,
  buildSitemapIndexEntries,
  buildSitemapIndexXml,
  createCachedSitemapResponse,
  getDynamicSitemapStats,
} from '$lib/server/seo/sitemap';

export const GET: RequestHandler = async ({ platform }) => {
  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  return createCachedSitemapResponse({
    cacheKey: 'sitemap:index:xml',
    ttl: SITEMAP_INDEX_CACHE_TTL,
    cacheControl: SITEMAP_INDEX_CACHE_CONTROL,
    debugTag: 'index',
    waitUntil,
    fetcher: async () => {
      const stats = await getDynamicSitemapStats(db);
      return buildSitemapIndexXml(buildSitemapIndexEntries(stats));
    },
  });
};

export const HEAD = GET;
