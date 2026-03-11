import type { RequestHandler } from './$types';
import {
  SITEMAP_CORE_CACHE_CONTROL,
  SITEMAP_CORE_CACHE_TTL,
  SITEMAP_DYNAMIC_CACHE_CONTROL,
  SITEMAP_DYNAMIC_CACHE_TTL,
  type SitemapPage,
  SitemapNotFoundError,
  buildMissingSitemapResponse,
  getExpandedCoreSitemapPages,
  buildUrlSetXml,
  createCachedSitemapResponse,
  loadOrgsSitemapPage,
  loadProfilesSitemapPage,
  loadSkillsSitemapPage,
} from '$lib/server/sitemap';

const DYNAMIC_KIND_PATTERN = /^(skills|profiles|orgs)-([1-9]\d*)$/;

export const GET: RequestHandler = async ({ params, platform }) => {
  const slug = params.slug;
  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  if (slug === 'core') {
    return createCachedSitemapResponse({
      cacheKey: 'sitemap:core:xml',
      ttl: SITEMAP_CORE_CACHE_TTL,
      cacheControl: SITEMAP_CORE_CACHE_CONTROL,
      debugTag: 'core',
      waitUntil,
      fetcher: async () => buildUrlSetXml(await getExpandedCoreSitemapPages(db)),
    });
  }

  const match = DYNAMIC_KIND_PATTERN.exec(slug);
  if (!match) {
    return buildMissingSitemapResponse();
  }

  const [, kind, pagePart] = match;
  const page = Number(pagePart);

  return createCachedSitemapResponse({
    cacheKey: `sitemap:${kind}:${page}:xml`,
    ttl: SITEMAP_DYNAMIC_CACHE_TTL,
    cacheControl: SITEMAP_DYNAMIC_CACHE_CONTROL,
    debugTag: `${kind}-${page}`,
    waitUntil,
    fetcher: async () => {
      let pages: SitemapPage[];

      switch (kind) {
        case 'skills':
          pages = await loadSkillsSitemapPage(db, page);
          break;
        case 'profiles':
          pages = await loadProfilesSitemapPage(db, page);
          break;
        case 'orgs':
          pages = await loadOrgsSitemapPage(db, page);
          break;
        default:
          pages = [];
      }

      if (pages.length === 0) {
        throw new SitemapNotFoundError();
      }

      return buildUrlSetXml(pages);
    },
  });
};

export const HEAD = GET;
