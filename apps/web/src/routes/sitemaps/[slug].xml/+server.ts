import type { RequestHandler } from './$types';
import {
  SITEMAP_CORE_CACHE_CONTROL,
  SITEMAP_CORE_CACHE_TTL,
  SITEMAP_DYNAMIC_CACHE_CONTROL,
  SITEMAP_DYNAMIC_CACHE_TTL,
  buildUrlSetXml,
  createCachedSitemapResponse,
  getCoreSitemapPages,
  loadOrgsSitemapPage,
  loadProfilesSitemapPage,
  loadSkillsSitemapPage,
} from '$lib/server/sitemap';

const DYNAMIC_KIND_PATTERN = /^(skills|profiles|orgs)-([1-9]\d*)$/;

function invalidSitemapResponse(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ params, platform }) => {
  const slug = params.slug;
  const db = platform?.env?.DB;

  if (slug === 'core') {
    return createCachedSitemapResponse({
      cacheKey: 'sitemap:core:xml',
      ttl: SITEMAP_CORE_CACHE_TTL,
      cacheControl: SITEMAP_CORE_CACHE_CONTROL,
      debugTag: 'core',
      fetcher: async () => buildUrlSetXml(getCoreSitemapPages()),
    });
  }

  const match = DYNAMIC_KIND_PATTERN.exec(slug);
  if (!match) {
    return invalidSitemapResponse();
  }

  const [, kind, pagePart] = match;
  const page = Number(pagePart);

  return createCachedSitemapResponse({
    cacheKey: `sitemap:${kind}:${page}:xml`,
    ttl: SITEMAP_DYNAMIC_CACHE_TTL,
    cacheControl: SITEMAP_DYNAMIC_CACHE_CONTROL,
    debugTag: `${kind}-${page}`,
    fetcher: async () => {
      try {
        switch (kind) {
          case 'skills':
            return buildUrlSetXml(await loadSkillsSitemapPage(db, page));
          case 'profiles':
            return buildUrlSetXml(await loadProfilesSitemapPage(db, page));
          case 'orgs':
            return buildUrlSetXml(await loadOrgsSitemapPage(db, page));
          default:
            return buildUrlSetXml([]);
        }
      } catch (error) {
        console.error(`Error building sitemap page ${kind}-${page}:`, error);
        return buildUrlSetXml([]);
      }
    },
  });
};

export const HEAD = GET;
