import type { RequestHandler } from './$types';
import {
  type SitemapPage,
  SitemapNotFoundError,
  buildMissingSitemapResponse,
  buildSitemapCacheControl,
  getExpandedCoreSitemapPages,
  buildUrlSetXml,
  createCachedSitemapResponse,
  getSitemapHotCacheTtlSeconds,
  getSitemapSharedMaxAgeSeconds,
  loadOrgsSitemapPage,
  loadProfilesSitemapPage,
  loadRecentOrgsSitemapPages,
  loadRecentProfilesSitemapPages,
  loadRecentSkillsSitemapPages,
  loadSkillsSitemapPage,
  normalizeSitemapRefreshMinIntervalSeconds,
  SITEMAP_CORE_BROWSER_MAX_AGE_SECONDS,
  SITEMAP_CORE_CACHE_TTL,
  SITEMAP_CORE_SHARED_MAX_AGE_SECONDS,
  SITEMAP_CORE_STALE_WHILE_REVALIDATE_SECONDS,
  SITEMAP_DYNAMIC_BROWSER_MAX_AGE_SECONDS,
  SITEMAP_DYNAMIC_CACHE_TTL,
  SITEMAP_DYNAMIC_SHARED_MAX_AGE_SECONDS,
  SITEMAP_DYNAMIC_STALE_WHILE_REVALIDATE_SECONDS,
} from '$lib/server/seo/sitemap';

const DYNAMIC_KIND_PATTERN = /^(skills|profiles|orgs)-([1-9]\d*)$/;
const RECENT_KIND_PATTERN = /^recent-(skills|profiles|orgs)$/;

export const GET: RequestHandler = async ({ params, platform }) => {
  const slug = params.slug;
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const refreshMinIntervalSeconds = normalizeSitemapRefreshMinIntervalSeconds(
    platform?.env?.SITEMAP_REFRESH_MIN_INTERVAL_SECONDS
  );
  const snapshotMaxAgeSeconds = refreshMinIntervalSeconds;

  if (slug === 'core') {
    return createCachedSitemapResponse({
      cacheKey: 'sitemap:core:xml',
      ttl: getSitemapHotCacheTtlSeconds(SITEMAP_CORE_CACHE_TTL, refreshMinIntervalSeconds),
      cacheControl: buildSitemapCacheControl({
        browserMaxAgeSeconds: SITEMAP_CORE_BROWSER_MAX_AGE_SECONDS,
        sharedMaxAgeSeconds: getSitemapSharedMaxAgeSeconds(
          SITEMAP_CORE_SHARED_MAX_AGE_SECONDS,
          refreshMinIntervalSeconds
        ),
        staleWhileRevalidateSeconds: SITEMAP_CORE_STALE_WHILE_REVALIDATE_SECONDS,
      }),
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
      ttl: getSitemapHotCacheTtlSeconds(SITEMAP_DYNAMIC_CACHE_TTL, refreshMinIntervalSeconds),
      cacheControl: buildSitemapCacheControl({
        browserMaxAgeSeconds: SITEMAP_DYNAMIC_BROWSER_MAX_AGE_SECONDS,
        sharedMaxAgeSeconds: getSitemapSharedMaxAgeSeconds(
          SITEMAP_DYNAMIC_SHARED_MAX_AGE_SECONDS,
          refreshMinIntervalSeconds
        ),
        staleWhileRevalidateSeconds: SITEMAP_DYNAMIC_STALE_WHILE_REVALIDATE_SECONDS,
      }),
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
    ttl: getSitemapHotCacheTtlSeconds(SITEMAP_DYNAMIC_CACHE_TTL, refreshMinIntervalSeconds),
    cacheControl: buildSitemapCacheControl({
      browserMaxAgeSeconds: SITEMAP_DYNAMIC_BROWSER_MAX_AGE_SECONDS,
      sharedMaxAgeSeconds: getSitemapSharedMaxAgeSeconds(
        SITEMAP_DYNAMIC_SHARED_MAX_AGE_SECONDS,
        refreshMinIntervalSeconds
      ),
      staleWhileRevalidateSeconds: SITEMAP_DYNAMIC_STALE_WHILE_REVALIDATE_SECONDS,
    }),
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
