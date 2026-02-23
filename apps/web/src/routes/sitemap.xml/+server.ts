import type { RequestHandler } from './$types';
import {
  SITEMAP_INDEX_CACHE_CONTROL,
  SITEMAP_INDEX_CACHE_TTL,
  buildSitemapIndexEntries,
  buildSitemapIndexXml,
  createCachedSitemapResponse,
  getDynamicSitemapStats,
} from '$lib/server/sitemap';

export const GET: RequestHandler = async ({ platform }) => {
  const db = platform?.env?.DB;

  return createCachedSitemapResponse({
    cacheKey: 'sitemap:index:xml',
    ttl: SITEMAP_INDEX_CACHE_TTL,
    cacheControl: SITEMAP_INDEX_CACHE_CONTROL,
    debugTag: 'index',
    fetcher: async () => {
      try {
        const stats = await getDynamicSitemapStats(db);
        return buildSitemapIndexXml(buildSitemapIndexEntries(stats));
      } catch (error) {
        console.error('Error building sitemap index:', error);
        return buildSitemapIndexXml([{ url: '/sitemaps/core.xml' }]);
      }
    },
  });
};

export const HEAD = GET;
