import { CATEGORIES } from '$lib/constants/categories';
import { getCachedText } from '$lib/server/cache';
import { encodeSkillSlugForPath } from '$lib/skill-path';

export const SITE_URL = 'https://skills.cat';
// Keep each sitemap comfortably small so bots can fetch them quickly even on cold builds.
export const SITEMAP_URL_LIMIT = 5000;

export const SITEMAP_INDEX_CACHE_TTL = 600;
export const SITEMAP_DYNAMIC_CACHE_TTL = 900;
export const SITEMAP_CORE_CACHE_TTL = 86400;
export const PUBLIC_LIST_PAGE_SIZE = 24;
export const MAX_CORE_LIST_SITEMAP_PAGES = 10;
export const MAX_CORE_CATEGORY_SITEMAP_PAGES = 5;

export const SITEMAP_INDEX_CACHE_CONTROL =
  'public, max-age=300, s-maxage=600, stale-while-revalidate=3600';
export const SITEMAP_DYNAMIC_CACHE_CONTROL =
  'public, max-age=300, s-maxage=900, stale-while-revalidate=86400';
export const SITEMAP_CORE_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

const inflightSitemapBuilds = new Map<string, Promise<string>>();
type WaitUntilFn = (promise: Promise<unknown>) => void;

type ChangeFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

interface D1Result<T> {
  results?: T[];
}

interface D1BoundStatement {
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
}

interface D1PreparedStatement {
  bind(...args: unknown[]): D1BoundStatement;
}

export interface SitemapDb {
  prepare(query: string): D1PreparedStatement;
}

export interface SitemapPage {
  url: string;
  priority: string;
  changefreq: ChangeFrequency;
  lastmod?: string;
}

export interface SitemapIndexEntry {
  url: string;
  lastmod?: string;
}

export type DynamicSitemapKind = 'skills' | 'profiles' | 'orgs';

export interface DynamicSitemapStats {
  count: number;
  pages: number;
  lastmod?: string;
}

export type DynamicSitemapStatsMap = Record<DynamicSitemapKind, DynamicSitemapStats>;

interface CountAndMaxRow {
  count: number | string | null;
  max_ts: number | string | null;
}

interface CategoryCountRow extends CountAndMaxRow {
  slug: string | null;
}

export class SitemapNotFoundError extends Error {
  constructor(message = 'Sitemap not found') {
    super(message);
    this.name = 'SitemapNotFoundError';
  }
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toIsoDate(timestamp: unknown): string | undefined {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return new Date(numeric).toISOString().split('T')[0];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function dedupePages(pages: SitemapPage[]): SitemapPage[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.url)) return false;
    seen.add(page.url);
    return true;
  });
}

export function buildUrlSetXml(pages: SitemapPage[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (page) => `  <url>
    <loc>${escapeXml(`${SITE_URL}${page.url}`)}</loc>
    ${page.lastmod ? `<lastmod>${page.lastmod}</lastmod>\n    ` : ''}<changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;
}

export function buildSitemapIndexXml(entries: SitemapIndexEntry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) => `  <sitemap>
    <loc>${escapeXml(`${SITE_URL}${entry.url}`)}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ''}
  </sitemap>`
  )
  .join('\n')}
</sitemapindex>`;
}

export function getCoreSitemapPages(): SitemapPage[] {
  const staticPages = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
    { url: '/docs', priority: '0.8', changefreq: 'weekly' },
    { url: '/docs/cli', priority: '0.75', changefreq: 'weekly' },
    { url: '/docs/openclaw', priority: '0.75', changefreq: 'weekly' },
    { url: '/trending', priority: '0.9', changefreq: 'hourly' },
    { url: '/recent', priority: '0.9', changefreq: 'hourly' },
    { url: '/top', priority: '0.9', changefreq: 'daily' },
    { url: '/categories', priority: '0.8', changefreq: 'weekly' },
    { url: '/llm.txt', priority: '0.5', changefreq: 'weekly' },
    { url: '/privacy', priority: '0.3', changefreq: 'monthly' },
    { url: '/terms', priority: '0.3', changefreq: 'monthly' },
  ] satisfies SitemapPage[];

  const categoryPages = CATEGORIES.map((cat) => ({
    url: `/category/${cat.slug}`,
    priority: '0.7',
    changefreq: 'daily',
  })) satisfies SitemapPage[];

  return dedupePages([...staticPages, ...categoryPages]);
}

function buildPaginatedCollectionPages(options: {
  baseUrl: string;
  totalItems: number;
  maxPages: number;
  priority: string;
  changefreq: ChangeFrequency;
  lastmod?: string;
}): SitemapPage[] {
  const { baseUrl, totalItems, maxPages, priority, changefreq, lastmod } = options;
  const totalPages = Math.ceil(totalItems / PUBLIC_LIST_PAGE_SIZE);
  const endPage = Math.min(totalPages, maxPages);

  const pages: SitemapPage[] = [];
  for (let page = 2; page <= endPage; page += 1) {
    pages.push({
      url: `${baseUrl}?page=${page}`,
      priority,
      changefreq,
      lastmod,
    });
  }

  return pages;
}

export async function getExpandedCoreSitemapPages(
  db: SitemapDb | undefined
): Promise<SitemapPage[]> {
  const basePages = getCoreSitemapPages();
  if (!db) return basePages;

  const publicSkillsRow = await db.prepare(`
    SELECT COUNT(*) AS count, MAX(COALESCE(last_commit_at, updated_at, indexed_at)) AS max_ts
    FROM skills
    WHERE visibility = 'public'
  `).bind().first<CountAndMaxRow>();

  const publicSkillCount = Math.max(0, toNumber(publicSkillsRow?.count));
  const publicSkillLastmod = toIsoDate(publicSkillsRow?.max_ts);

  const listPages = [
    ...buildPaginatedCollectionPages({
      baseUrl: '/trending',
      totalItems: publicSkillCount,
      maxPages: MAX_CORE_LIST_SITEMAP_PAGES,
      priority: '0.8',
      changefreq: 'hourly',
      lastmod: publicSkillLastmod,
    }),
    ...buildPaginatedCollectionPages({
      baseUrl: '/recent',
      totalItems: publicSkillCount,
      maxPages: MAX_CORE_LIST_SITEMAP_PAGES,
      priority: '0.8',
      changefreq: 'hourly',
      lastmod: publicSkillLastmod,
    }),
    ...buildPaginatedCollectionPages({
      baseUrl: '/top',
      totalItems: publicSkillCount,
      maxPages: MAX_CORE_LIST_SITEMAP_PAGES,
      priority: '0.75',
      changefreq: 'daily',
      lastmod: publicSkillLastmod,
    }),
  ];

  const categorySlugs = CATEGORIES.map((category) => category.slug);
  if (categorySlugs.length === 0) {
    return dedupePages([...basePages, ...listPages]);
  }

  const categoryPlaceholders = categorySlugs.map(() => '?').join(', ');
  const categoryCounts = await db.prepare(`
    SELECT
      sc.category_slug AS slug,
      COUNT(*) AS count,
      MAX(COALESCE(s.last_commit_at, s.updated_at, s.indexed_at)) AS max_ts
    FROM skill_categories sc
    JOIN skills s ON s.id = sc.skill_id
    WHERE s.visibility = 'public'
      AND sc.category_slug IN (${categoryPlaceholders})
    GROUP BY sc.category_slug
  `)
    .bind(...categorySlugs)
    .all<CategoryCountRow>();

  const categoryCountMap = new Map(
    (categoryCounts.results || [])
      .filter((row): row is CategoryCountRow & { slug: string } => typeof row.slug === 'string' && row.slug.length > 0)
      .map((row) => [row.slug, row])
  );

  const categoryPages = CATEGORIES.flatMap((category) => {
    const row = categoryCountMap.get(category.slug);
    if (!row) return [];

    return buildPaginatedCollectionPages({
      baseUrl: `/category/${category.slug}`,
      totalItems: Math.max(0, toNumber(row.count)),
      maxPages: MAX_CORE_CATEGORY_SITEMAP_PAGES,
      priority: '0.65',
      changefreq: 'daily',
      lastmod: toIsoDate(row.max_ts),
    });
  });

  return dedupePages([...basePages, ...listPages, ...categoryPages]);
}

export async function getDynamicSitemapStats(db: SitemapDb | undefined): Promise<DynamicSitemapStatsMap> {
  if (!db) {
    return {
      skills: { count: 0, pages: 0 },
      profiles: { count: 0, pages: 0 },
      orgs: { count: 0, pages: 0 },
    };
  }

  const [skillsRow, profilesRow, orgsRow] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count, MAX(COALESCE(last_commit_at, updated_at, indexed_at)) AS max_ts
      FROM skills
      WHERE visibility = 'public'
    `).bind().first<CountAndMaxRow>(),
    db.prepare(`
      SELECT COUNT(*) AS count, MAX(updated_at) AS max_ts
      FROM authors
      WHERE username IS NOT NULL AND skills_count > 0
    `).bind().first<CountAndMaxRow>(),
    db.prepare(`
      SELECT COUNT(*) AS count, MAX(o.updated_at) AS max_ts
      FROM organizations o
      WHERE EXISTS (
        SELECT 1
        FROM skills s
        WHERE s.org_id = o.id AND s.visibility = 'public'
      )
    `).bind().first<CountAndMaxRow>(),
  ]);

  const toStats = (row: CountAndMaxRow | null): DynamicSitemapStats => {
    const count = Math.max(0, toNumber(row?.count));
    return {
      count,
      pages: Math.ceil(count / SITEMAP_URL_LIMIT),
      lastmod: toIsoDate(row?.max_ts),
    };
  };

  return {
    skills: toStats(skillsRow),
    profiles: toStats(profilesRow),
    orgs: toStats(orgsRow),
  };
}

export function buildSitemapIndexEntries(stats: DynamicSitemapStatsMap): SitemapIndexEntry[] {
  const entries: SitemapIndexEntry[] = [{ url: '/sitemaps/core.xml' }];
  const orderedKinds: DynamicSitemapKind[] = ['skills', 'profiles', 'orgs'];

  for (const kind of orderedKinds) {
    const { pages, lastmod } = stats[kind];
    for (let page = 1; page <= pages; page += 1) {
      entries.push({
        url: `/sitemaps/${kind}-${page}.xml`,
        lastmod,
      });
    }
  }

  return entries;
}

export async function loadSkillsSitemapPage(
  db: SitemapDb | undefined,
  page: number
): Promise<SitemapPage[]> {
  if (!db) return [];

  const offset = (page - 1) * SITEMAP_URL_LIMIT;
  const skills = await db.prepare(`
    SELECT slug, updated_at, indexed_at, last_commit_at
    FROM skills
    WHERE visibility = 'public'
    ORDER BY slug ASC
    LIMIT ? OFFSET ?
  `)
    .bind(SITEMAP_URL_LIMIT, offset)
    .all<{
      slug: string;
      updated_at: number | null;
      indexed_at: number | null;
      last_commit_at: number | null;
    }>();

  return (skills.results || []).map((skill) => ({
    url: `/skills/${encodeSkillSlugForPath(skill.slug)}`,
    priority: '0.6',
    changefreq: 'weekly',
    lastmod: toIsoDate(skill.last_commit_at ?? skill.updated_at ?? skill.indexed_at),
  }));
}

export async function loadProfilesSitemapPage(
  db: SitemapDb | undefined,
  page: number
): Promise<SitemapPage[]> {
  if (!db) return [];

  const offset = (page - 1) * SITEMAP_URL_LIMIT;
  const profiles = await db.prepare(`
    SELECT username, updated_at
    FROM authors
    WHERE username IS NOT NULL AND skills_count > 0
    ORDER BY username ASC
    LIMIT ? OFFSET ?
  `)
    .bind(SITEMAP_URL_LIMIT, offset)
    .all<{ username: string; updated_at: number | null }>();

  return (profiles.results || []).map((profile) => ({
    url: `/u/${encodeURIComponent(profile.username)}`,
    priority: '0.5',
    changefreq: 'weekly',
    lastmod: toIsoDate(profile.updated_at),
  }));
}

export async function loadOrgsSitemapPage(
  db: SitemapDb | undefined,
  page: number
): Promise<SitemapPage[]> {
  if (!db) return [];

  const offset = (page - 1) * SITEMAP_URL_LIMIT;
  const orgs = await db.prepare(`
    SELECT o.slug, o.updated_at
    FROM organizations o
    WHERE EXISTS (
      SELECT 1
      FROM skills s
      WHERE s.org_id = o.id AND s.visibility = 'public'
    )
    ORDER BY o.slug ASC
    LIMIT ? OFFSET ?
  `)
    .bind(SITEMAP_URL_LIMIT, offset)
    .all<{ slug: string; updated_at: number | null }>();

  return (orgs.results || []).map((org) => ({
    url: `/org/${encodeURIComponent(org.slug)}`,
    priority: '0.55',
    changefreq: 'daily',
    lastmod: toIsoDate(org.updated_at),
  }));
}

export function buildMissingSitemapResponse(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}

export function buildUnavailableSitemapResponse(debugTag: string): Response {
  return new Response('Service unavailable', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '300',
      'X-Sitemap': debugTag,
    },
  });
}

export async function createCachedSitemapResponse(options: {
  cacheKey: string;
  ttl: number;
  cacheControl: string;
  fetcher: () => Promise<string>;
  debugTag: string;
  waitUntil?: WaitUntilFn;
}): Promise<Response> {
  const { cacheKey, ttl, cacheControl, fetcher, debugTag, waitUntil } = options;

  try {
    const { data: xml, hit } = await getCachedText(
      cacheKey,
      async () => {
        const existing = inflightSitemapBuilds.get(cacheKey);
        if (existing) {
          return existing;
        }

        const promise = fetcher().finally(() => {
          inflightSitemapBuilds.delete(cacheKey);
        });

        inflightSitemapBuilds.set(cacheKey, promise);
        return promise;
      },
      ttl,
      { waitUntil }
    );

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': cacheControl,
        'X-Cache': hit ? 'HIT' : 'MISS',
        'X-Sitemap': debugTag,
      },
    });
  } catch (error) {
    if (error instanceof SitemapNotFoundError) {
      return buildMissingSitemapResponse();
    }

    console.error(`Error building sitemap ${debugTag}:`, error);
    return buildUnavailableSitemapResponse(debugTag);
  }
}
