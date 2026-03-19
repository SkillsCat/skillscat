import type { RequestHandler } from './$types';
import {
  normalizeSitemapRefreshMinIntervalSeconds,
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
  loadRecentOrgsSitemapPages,
  loadRecentProfilesSitemapPages,
  loadRecentSkillsSitemapPages,
  loadSkillsSitemapPage,
} from '$lib/server/seo/sitemap';

const DYNAMIC_KIND_PATTERN = /^(skills|profiles|orgs)-([1-9]\d*)$/;
const RECENT_KIND_PATTERN = /^recent-(skills|profiles|orgs)$/;

export const GET: RequestHandler = async ({ params, platform }) => {
  const slug = params.slug;
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const snapshotMaxAgeSeconds = normalizeSitemapRefreshMinIntervalSeconds(
    platform?.env?.SITEMAP_REFRESH_MIN_INTERVAL_SECONDS
  );

  if (slug === 'core') {
    return createCachedSitemapResponse({
      cacheKey: 'sitemap:core:xml',
      ttl: SITEMAP_CORE_CACHE_TTL,
      cacheControl: SITEMAP_CORE_CACHE_CONTROL,
      debugTag: 'core',
      r2,
      snapshotMaxAgeSeconds,
      waitUntil,
      fetcher: async () => buildUrlSetXml(await getExpandedCoreSitemapPages(db)),
    });
  }

  const match = DYNAMIC_KIND_PATTERN.exec(slug);
  const recentMatch = RECENT_KIND_PATTERN.exec(slug);

  if (recentMatch) {
    const [, kind] = recentMatch;

    return createCachedSitemapResponse({
      cacheKey: `sitemap:recent:${kind}:xml`,
      ttl: SITEMAP_DYNAMIC_CACHE_TTL,
      cacheControl: SITEMAP_DYNAMIC_CACHE_CONTROL,
      debugTag: `recent-${kind}`,
      r2,
      snapshotMaxAgeSeconds,
      waitUntil,
      fetcher: async () => {
        let pages: SitemapPage[];

        switch (kind) {
          case 'skills':
            pages = await loadRecentSkillsSitemapPages(db);
            break;
          case 'profiles':
            pages = await loadRecentProfilesSitemapPages(db);
            break;
          case 'orgs':
            pages = await loadRecentOrgsSitemapPages(db);
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
  }

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
    r2,
    snapshotMaxAgeSeconds,
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
