import { CATEGORIES } from '$lib/constants/categories';
import { invalidateCache, peekCachedText, putCachedText } from '$lib/server/cache';
import { encodeSkillSlugForPath } from '$lib/skill-path';

export const SITE_URL = 'https://skills.cat';
// Keep each sitemap comfortably small so bots can fetch them quickly even on cold builds.
export const SITEMAP_URL_LIMIT = 5000;

export const SITEMAP_INDEX_BROWSER_MAX_AGE_SECONDS = 300;
export const SITEMAP_INDEX_SHARED_MAX_AGE_SECONDS = 600;
export const SITEMAP_INDEX_STALE_WHILE_REVALIDATE_SECONDS = 3600;
export const SITEMAP_DYNAMIC_BROWSER_MAX_AGE_SECONDS = 300;
export const SITEMAP_DYNAMIC_SHARED_MAX_AGE_SECONDS = 900;
export const SITEMAP_DYNAMIC_STALE_WHILE_REVALIDATE_SECONDS = 86400;
export const SITEMAP_CORE_BROWSER_MAX_AGE_SECONDS = 3600;
export const SITEMAP_CORE_SHARED_MAX_AGE_SECONDS = 86400;
export const SITEMAP_CORE_STALE_WHILE_REVALIDATE_SECONDS = 604800;
export const SITEMAP_INDEX_CACHE_TTL = 600;
export const SITEMAP_DYNAMIC_CACHE_TTL = 900;
export const SITEMAP_CORE_CACHE_TTL = 86400;
export const DEFAULT_SITEMAP_REFRESH_MIN_INTERVAL_SECONDS = 3600;
export const SITEMAP_HOT_CACHE_TTL_BUFFER_SECONDS = 300;
export const PUBLIC_LIST_PAGE_SIZE = 24;
export const MAX_CORE_LIST_SITEMAP_PAGES = 10;
export const MAX_CORE_CATEGORY_SITEMAP_PAGES = 5;
export const RECENT_SITEMAP_WINDOW_DAYS = 14;
export const RECENT_SITEMAP_URL_LIMIT = 1000;

const inflightSitemapBuilds = new Map<string, Promise<string>>();
const SITEMAP_SNAPSHOT_PREFIX = 'cache/sitemaps/v1';
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
export type RecentSitemapKind = DynamicSitemapKind;

export interface DynamicSitemapStats {
  count: number;
  pages: number;
  lastmod?: string;
}

export type DynamicSitemapStatsMap = Record<DynamicSitemapKind, DynamicSitemapStats>;

export interface RecentSitemapStats {
  count: number;
  lastmod?: string;
}

export type RecentSitemapStatsMap = Record<RecentSitemapKind, RecentSitemapStats>;

export interface SitemapIndexStats {
  dynamic: DynamicSitemapStatsMap;
  recent: RecentSitemapStatsMap;
}

interface CountAndMaxRow {
  count: number | string | null;
  max_ts: number | string | null;
}

interface CategoryCountRow extends CountAndMaxRow {
  slug: string | null;
}

interface CachedSitemapSnapshot {
  xml: string;
  generatedAt?: number;
}

interface EntitySitemapQueryConfig {
  table: 'authors' | 'organizations';
  alias: 'a' | 'o';
  labelColumn: 'username' | 'slug';
  entityMatchColumn: 'username' | 'id';
  matchColumn: 'repo_owner' | 'org_id';
  baseWhere: string;
  indexName: string;
  pathPrefix: '/u/' | '/org/';
  pagePriority: string;
  pageChangefreq: ChangeFrequency;
  recentPriority: string;
  recentChangefreq: ChangeFrequency;
}

interface EntityFreshnessRow {
  entity_label: string;
  freshness_ts: number | null;
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

function toTimestamp(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return numeric;
}

export function normalizeSitemapRefreshMinIntervalSeconds(
  value: string | number | undefined | null
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_SITEMAP_REFRESH_MIN_INTERVAL_SECONDS;
  }

  return Math.min(Math.max(Math.floor(numeric), 300), 86400);
}

export function getSitemapHotCacheTtlSeconds(
  baseTtlSeconds: number,
  refreshMinIntervalSeconds: number
): number {
  const normalizedBaseTtl = Math.max(0, Math.floor(baseTtlSeconds));
  const normalizedRefreshMinInterval = normalizeSitemapRefreshMinIntervalSeconds(
    refreshMinIntervalSeconds
  );

  return Math.max(
    normalizedBaseTtl,
    normalizedRefreshMinInterval + SITEMAP_HOT_CACHE_TTL_BUFFER_SECONDS
  );
}

export function getSitemapSharedMaxAgeSeconds(
  baseSharedMaxAgeSeconds: number,
  refreshMinIntervalSeconds: number
): number {
  return Math.max(
    Math.max(0, Math.floor(baseSharedMaxAgeSeconds)),
    normalizeSitemapRefreshMinIntervalSeconds(refreshMinIntervalSeconds)
  );
}

export function buildSitemapCacheControl(options: {
  browserMaxAgeSeconds: number;
  sharedMaxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
}): string {
  const browserMaxAgeSeconds = Math.max(0, Math.floor(options.browserMaxAgeSeconds));
  const sharedMaxAgeSeconds = Math.max(0, Math.floor(options.sharedMaxAgeSeconds));
  const staleWhileRevalidateSeconds = Math.max(0, Math.floor(options.staleWhileRevalidateSeconds));

  return `public, max-age=${browserMaxAgeSeconds}, s-maxage=${sharedMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}

function buildSkillFreshnessExpr(alias = 's'): string {
  return `CASE WHEN ${alias}.last_commit_at IS NULL THEN ${alias}.updated_at ELSE ${alias}.last_commit_at END`;
}

function buildSkillFreshnessCase(updatedExpr: string, skillFreshnessExpr: string): string {
  return `CASE
    WHEN ${updatedExpr} > COALESCE(${skillFreshnessExpr}, 0)
      THEN ${updatedExpr}
    ELSE ${skillFreshnessExpr}
  END`;
}

const PROFILE_SITEMAP_QUERY_CONFIG: EntitySitemapQueryConfig = {
  table: 'authors',
  alias: 'a',
  labelColumn: 'username',
  entityMatchColumn: 'username',
  matchColumn: 'repo_owner',
  baseWhere: 'a.username IS NOT NULL',
  indexName: 'skills_public_repo_owner_sitemap_freshness_idx',
  pathPrefix: '/u/',
  pagePriority: '0.5',
  pageChangefreq: 'weekly',
  recentPriority: '0.6',
  recentChangefreq: 'daily',
};

const ORG_SITEMAP_QUERY_CONFIG: EntitySitemapQueryConfig = {
  table: 'organizations',
  alias: 'o',
  labelColumn: 'slug',
  entityMatchColumn: 'id',
  matchColumn: 'org_id',
  baseWhere: '1 = 1',
  indexName: 'skills_public_org_sitemap_freshness_idx',
  pathPrefix: '/org/',
  pagePriority: '0.55',
  pageChangefreq: 'daily',
  recentPriority: '0.65',
  recentChangefreq: 'daily',
};

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

  return dedupePages(staticPages);
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
      category_slug AS slug,
      public_skill_count AS count,
      max_freshness_ts AS max_ts
    FROM category_public_stats
    WHERE category_slug IN (${categoryPlaceholders})
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
    const totalItems = Math.max(0, toNumber(row?.count));
    if (!row || totalItems <= 0) return [];

    const baseUrl = `/category/${category.slug}`;
    const lastmod = toIsoDate(row.max_ts);

    return [
      {
        url: baseUrl,
        priority: '0.7',
        changefreq: 'daily',
        lastmod,
      } satisfies SitemapPage,
      ...buildPaginatedCollectionPages({
        baseUrl,
        totalItems,
        maxPages: MAX_CORE_CATEGORY_SITEMAP_PAGES,
        priority: '0.65',
        changefreq: 'daily',
        lastmod,
      }),
    ];
  });

  return dedupePages([...basePages, ...listPages, ...categoryPages]);
}

function getRecentCutoffTimestamp(now = Date.now()): number {
  return now - (RECENT_SITEMAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function getEntityLabelExpr(config: EntitySitemapQueryConfig, alias = config.alias): string {
  return `${alias}.${config.labelColumn}`;
}

function getEntityMatchExpr(config: EntitySitemapQueryConfig, alias = config.alias): string {
  return `${alias}.${config.entityMatchColumn}`;
}

function getEntityUpdatedExpr(alias: string): string {
  return `${alias}.updated_at`;
}

function buildEntityHasAnyPublicSkillsExists(
  config: EntitySitemapQueryConfig,
  matchExpr: string
): string {
  return `EXISTS (
    SELECT 1
    FROM skills s INDEXED BY ${config.indexName}
    WHERE s.visibility = 'public'
      AND s.${config.matchColumn} = ${matchExpr}
    LIMIT 1
  )`;
}

function buildEntityHasRecentPublicSkillsExists(
  config: EntitySitemapQueryConfig,
  matchExpr: string
): string {
  return `EXISTS (
    SELECT 1
    FROM skills s INDEXED BY ${config.indexName}
    WHERE s.visibility = 'public'
      AND s.${config.matchColumn} = ${matchExpr}
      AND ${buildSkillFreshnessExpr('s')} >= ?
    LIMIT 1
  )`;
}

function buildEntityLatestSkillFreshnessSubquery(
  config: EntitySitemapQueryConfig,
  matchExpr: string
): string {
  return `(
    SELECT ${buildSkillFreshnessExpr('s')}
    FROM skills s INDEXED BY ${config.indexName}
    WHERE s.visibility = 'public'
      AND s.${config.matchColumn} = ${matchExpr}
    ORDER BY ${buildSkillFreshnessExpr('s')} DESC
    LIMIT 1
  )`;
}

async function getDynamicEntitySitemapStats(
  db: SitemapDb,
  config: EntitySitemapQueryConfig
): Promise<DynamicSitemapStats> {
  const entityUpdatedExpr = getEntityUpdatedExpr(config.alias);
  const entityMatchExpr = getEntityMatchExpr(config);
  const skillFreshnessExpr = 'skill_freshness_ts';

  const row = await db.prepare(`
    WITH entity_skill_freshness AS (
      SELECT
        ${entityUpdatedExpr} AS updated_at,
        ${buildEntityLatestSkillFreshnessSubquery(config, entityMatchExpr)} AS ${skillFreshnessExpr}
      FROM ${config.table} ${config.alias}
      WHERE ${config.baseWhere}
        AND ${buildEntityHasAnyPublicSkillsExists(config, entityMatchExpr)}
    )
    SELECT
      COUNT(*) AS count,
      MAX(${buildSkillFreshnessCase('updated_at', skillFreshnessExpr)}) AS max_ts
    FROM entity_skill_freshness
  `).bind().first<CountAndMaxRow>();

  const count = Math.max(0, toNumber(row?.count));
  return {
    count,
    pages: Math.ceil(count / SITEMAP_URL_LIMIT),
    lastmod: toIsoDate(row?.max_ts),
  };
}

async function getRecentEntitySitemapStats(
  db: SitemapDb,
  config: EntitySitemapQueryConfig,
  recentCutoffTimestamp: number
): Promise<RecentSitemapStats> {
  const entityUpdatedExpr = getEntityUpdatedExpr(config.alias);
  const entityMatchExpr = getEntityMatchExpr(config);
  const skillFreshnessExpr = 'skill_freshness_ts';

  const row = await db.prepare(`
    WITH recent_entities AS (
      SELECT
        ${entityUpdatedExpr} AS updated_at,
        ${buildEntityLatestSkillFreshnessSubquery(config, entityMatchExpr)} AS ${skillFreshnessExpr}
      FROM ${config.table} ${config.alias}
      WHERE ${config.baseWhere}
        AND (
          ${entityUpdatedExpr} >= ?
          OR ${buildEntityHasRecentPublicSkillsExists(config, entityMatchExpr)}
        )
    )
    SELECT
      COUNT(*) AS count,
      MAX(${buildSkillFreshnessCase('updated_at', skillFreshnessExpr)}) AS max_ts
    FROM recent_entities
    WHERE ${skillFreshnessExpr} IS NOT NULL
  `).bind(recentCutoffTimestamp, recentCutoffTimestamp).first<CountAndMaxRow>();

  return {
    count: Math.max(0, toNumber(row?.count)),
    lastmod: toIsoDate(row?.max_ts),
  };
}

async function loadEntitySitemapPage(
  db: SitemapDb,
  config: EntitySitemapQueryConfig,
  page: number
): Promise<SitemapPage[]> {
  const offset = (page - 1) * SITEMAP_URL_LIMIT;
  const entityUpdatedExpr = getEntityUpdatedExpr(config.alias);
  const entityMatchExpr = getEntityMatchExpr(config);
  const skillFreshnessExpr = 'skill_freshness_ts';
  const labelExpr = getEntityLabelExpr(config);

  const rows = await db.prepare(`
    WITH paged_entities AS (
      SELECT
        ${labelExpr} AS entity_label,
        ${entityUpdatedExpr} AS updated_at,
        ${buildEntityLatestSkillFreshnessSubquery(config, entityMatchExpr)} AS ${skillFreshnessExpr}
      FROM ${config.table} ${config.alias}
      WHERE ${config.baseWhere}
        AND ${buildEntityHasAnyPublicSkillsExists(config, entityMatchExpr)}
      ORDER BY ${labelExpr} ASC
      LIMIT ? OFFSET ?
    )
    SELECT
      entity_label,
      ${buildSkillFreshnessCase('updated_at', skillFreshnessExpr)} AS freshness_ts
    FROM paged_entities
    ORDER BY entity_label ASC
  `)
    .bind(SITEMAP_URL_LIMIT, offset)
    .all<EntityFreshnessRow>();

  return (rows.results || []).map((row) => ({
    url: `${config.pathPrefix}${encodeURIComponent(row.entity_label)}`,
    priority: config.pagePriority,
    changefreq: config.pageChangefreq,
    lastmod: toIsoDate(row.freshness_ts),
  }));
}

async function loadRecentEntitySitemapPages(
  db: SitemapDb,
  config: EntitySitemapQueryConfig,
  recentCutoffTimestamp: number
): Promise<SitemapPage[]> {
  const entityUpdatedExpr = getEntityUpdatedExpr(config.alias);
  const entityMatchExpr = getEntityMatchExpr(config);
  const skillFreshnessExpr = 'skill_freshness_ts';
  const labelExpr = getEntityLabelExpr(config);

  const rows = await db.prepare(`
    WITH recent_entities AS (
      SELECT
        ${labelExpr} AS entity_label,
        ${entityUpdatedExpr} AS updated_at,
        ${buildEntityLatestSkillFreshnessSubquery(config, entityMatchExpr)} AS ${skillFreshnessExpr}
      FROM ${config.table} ${config.alias}
      WHERE ${config.baseWhere}
        AND (
          ${entityUpdatedExpr} >= ?
          OR ${buildEntityHasRecentPublicSkillsExists(config, entityMatchExpr)}
        )
    )
    SELECT
      entity_label,
      ${buildSkillFreshnessCase('updated_at', skillFreshnessExpr)} AS freshness_ts
    FROM recent_entities
    WHERE ${skillFreshnessExpr} IS NOT NULL
    ORDER BY freshness_ts DESC, entity_label ASC
    LIMIT ?
  `)
    .bind(recentCutoffTimestamp, recentCutoffTimestamp, RECENT_SITEMAP_URL_LIMIT)
    .all<EntityFreshnessRow>();

  return (rows.results || []).map((row) => ({
    url: `${config.pathPrefix}${encodeURIComponent(row.entity_label)}`,
    priority: config.recentPriority,
    changefreq: config.recentChangefreq,
    lastmod: toIsoDate(row.freshness_ts),
  }));
}

export async function getSitemapIndexStats(
  db: SitemapDb | undefined,
  now = Date.now()
): Promise<SitemapIndexStats> {
  if (!db) {
    return {
      dynamic: {
        skills: { count: 0, pages: 0 },
        profiles: { count: 0, pages: 0 },
        orgs: { count: 0, pages: 0 },
      },
      recent: {
        skills: { count: 0 },
        profiles: { count: 0 },
        orgs: { count: 0 },
      },
    };
  }

  const recentCutoffTimestamp = getRecentCutoffTimestamp(now);
  const [skillsRow, profilesStats, orgsStats, recentSkillsRow, recentProfilesStats, recentOrgsStats] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count, MAX(${buildSkillFreshnessExpr()}) AS max_ts
      FROM skills
      WHERE visibility = 'public'
    `).bind().first<CountAndMaxRow>(),
    getDynamicEntitySitemapStats(db, PROFILE_SITEMAP_QUERY_CONFIG),
    getDynamicEntitySitemapStats(db, ORG_SITEMAP_QUERY_CONFIG),
    db.prepare(`
      SELECT COUNT(*) AS count, MAX(${buildSkillFreshnessExpr()}) AS max_ts
      FROM skills
      WHERE visibility = 'public'
        AND ${buildSkillFreshnessExpr()} >= ?
    `).bind(recentCutoffTimestamp).first<CountAndMaxRow>(),
    getRecentEntitySitemapStats(db, PROFILE_SITEMAP_QUERY_CONFIG, recentCutoffTimestamp),
    getRecentEntitySitemapStats(db, ORG_SITEMAP_QUERY_CONFIG, recentCutoffTimestamp),
  ]);

  const toDynamicStats = (row: CountAndMaxRow | null): DynamicSitemapStats => {
    const count = Math.max(0, toNumber(row?.count));
    return {
      count,
      pages: Math.ceil(count / SITEMAP_URL_LIMIT),
      lastmod: toIsoDate(row?.max_ts),
    };
  };

  const toRecentStats = (row: CountAndMaxRow | null): RecentSitemapStats => ({
    count: Math.max(0, toNumber(row?.count)),
    lastmod: toIsoDate(row?.max_ts),
  });

  return {
    dynamic: {
      skills: toDynamicStats(skillsRow),
      profiles: profilesStats,
      orgs: orgsStats,
    },
    recent: {
      skills: toRecentStats(recentSkillsRow),
      profiles: recentProfilesStats,
      orgs: recentOrgsStats,
    },
  };
}

export function buildSitemapIndexEntries(stats: SitemapIndexStats): SitemapIndexEntry[] {
  const entries: SitemapIndexEntry[] = [{ url: '/sitemaps/core.xml' }];
  const orderedKinds: DynamicSitemapKind[] = ['skills', 'profiles', 'orgs'];

  for (const kind of orderedKinds) {
    const recentStats = stats.recent[kind];
    entries.push({
      url: `/sitemaps/recent-${kind}.xml`,
      lastmod: recentStats.lastmod,
    });
  }

  for (const kind of orderedKinds) {
    const { pages, lastmod } = stats.dynamic[kind];
    for (let page = 1; page <= pages; page += 1) {
      entries.push({
        url: `/sitemaps/${kind}-${page}.xml`,
        lastmod,
      });
    }
  }

  return entries;
}

export function buildSitemapPublicPaths(stats: SitemapIndexStats): string[] {
  return ['/sitemap.xml', ...buildSitemapIndexEntries(stats).map((entry) => entry.url)];
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

  return loadEntitySitemapPage(db, PROFILE_SITEMAP_QUERY_CONFIG, page);
}

export async function loadOrgsSitemapPage(
  db: SitemapDb | undefined,
  page: number
): Promise<SitemapPage[]> {
  if (!db) return [];

  return loadEntitySitemapPage(db, ORG_SITEMAP_QUERY_CONFIG, page);
}

export async function loadRecentSkillsSitemapPages(
  db: SitemapDb | undefined,
  now = Date.now()
): Promise<SitemapPage[]> {
  if (!db) return [];

  const recentCutoffTimestamp = getRecentCutoffTimestamp(now);
  const skills = await db.prepare(`
    SELECT
      slug,
      updated_at,
      indexed_at,
      last_commit_at,
      ${buildSkillFreshnessExpr()} AS sort_ts
    FROM skills
    WHERE visibility = 'public'
      AND ${buildSkillFreshnessExpr()} >= ?
    ORDER BY sort_ts DESC, slug ASC
    LIMIT ?
  `)
    .bind(recentCutoffTimestamp, RECENT_SITEMAP_URL_LIMIT)
    .all<{
      slug: string;
      updated_at: number | null;
      indexed_at: number | null;
      last_commit_at: number | null;
      sort_ts: number | null;
    }>();

  return (skills.results || []).map((skill) => ({
    url: `/skills/${encodeSkillSlugForPath(skill.slug)}`,
    priority: '0.7',
    changefreq: 'daily',
    lastmod: toIsoDate(skill.last_commit_at ?? skill.updated_at ?? skill.indexed_at),
  }));
}

export async function loadRecentProfilesSitemapPages(
  db: SitemapDb | undefined,
  now = Date.now()
): Promise<SitemapPage[]> {
  if (!db) return [];

  const recentCutoffTimestamp = getRecentCutoffTimestamp(now);
  return loadRecentEntitySitemapPages(db, PROFILE_SITEMAP_QUERY_CONFIG, recentCutoffTimestamp);
}

export async function loadRecentOrgsSitemapPages(
  db: SitemapDb | undefined,
  now = Date.now()
): Promise<SitemapPage[]> {
  if (!db) return [];

  const recentCutoffTimestamp = getRecentCutoffTimestamp(now);
  return loadRecentEntitySitemapPages(db, ORG_SITEMAP_QUERY_CONFIG, recentCutoffTimestamp);
}

function buildSitemapSnapshotKey(cacheKey: string): string {
  return `${SITEMAP_SNAPSHOT_PREFIX}/${cacheKey}.xml`;
}

async function readSitemapSnapshot(
  r2: R2Bucket | undefined,
  cacheKey: string
): Promise<CachedSitemapSnapshot | null> {
  if (!r2) return null;

  const object = await r2.get(buildSitemapSnapshotKey(cacheKey));
  if (!object) {
    return null;
  }

  return {
    xml: await object.text(),
    generatedAt: toTimestamp(object.customMetadata?.generatedAt),
  };
}

async function persistSitemapSnapshot(
  r2: R2Bucket | undefined,
  cacheKey: string,
  xml: string
): Promise<boolean> {
  if (!r2) return false;

  try {
    await r2.put(buildSitemapSnapshotKey(cacheKey), xml, {
      httpMetadata: {
        contentType: 'application/xml; charset=utf-8',
      },
      customMetadata: {
        generatedAt: String(Date.now()),
      },
    });
    return true;
  } catch (error) {
    console.error(`Failed to persist sitemap snapshot ${cacheKey}:`, error);
    return false;
  }
}

async function deleteSitemapSnapshot(
  r2: R2Bucket | undefined,
  cacheKey: string
): Promise<void> {
  if (!r2) return;
  await r2.delete(buildSitemapSnapshotKey(cacheKey));
}

async function cleanupStaleDynamicSitemapSnapshots(
  r2: R2Bucket | undefined,
  kind: DynamicSitemapKind,
  maxPage: number
): Promise<string[]> {
  if (!r2) return [];

  const removed: string[] = [];
  let cursor: string | undefined;

  do {
    const listing = await r2.list({
      prefix: `${SITEMAP_SNAPSHOT_PREFIX}/sitemap:${kind}:`,
      cursor,
    });

    for (const object of listing.objects) {
      const match = new RegExp(`^${SITEMAP_SNAPSHOT_PREFIX}/sitemap:${kind}:(\\d+)\\.xml$`).exec(object.key);
      if (!match) {
        continue;
      }

      const page = Number.parseInt(match[1], 10);
      if (!Number.isFinite(page) || page <= maxPage) {
        continue;
      }

      const cacheKey = `sitemap:${kind}:${page}:xml`;
      await Promise.all([
        r2.delete(object.key),
        invalidateCache(cacheKey),
      ]);
      removed.push(`${kind}-${page}`);
    }

    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return removed;
}

async function buildFreshSitemapXml(options: {
  cacheKey: string;
  fetcher: () => Promise<string>;
  ttl: number;
  waitUntil?: WaitUntilFn;
  r2?: R2Bucket;
}): Promise<string> {
  const { cacheKey, fetcher, ttl, waitUntil, r2 } = options;
  const existing = inflightSitemapBuilds.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const xml = await fetcher();
    await Promise.all([
      persistSitemapSnapshot(r2, cacheKey, xml),
      putCachedText(cacheKey, xml, ttl, {
        waitUntil,
        contentType: 'application/xml; charset=utf-8',
      }),
    ]);
    return xml;
  })().finally(() => {
    inflightSitemapBuilds.delete(cacheKey);
  });

  inflightSitemapBuilds.set(cacheKey, promise);
  return promise;
}

export async function refreshSitemapSnapshot(options: {
  cacheKey: string;
  ttl: number;
  fetcher: () => Promise<string>;
  waitUntil?: WaitUntilFn;
  r2?: R2Bucket;
}): Promise<string> {
  return buildFreshSitemapXml(options);
}

export interface SitemapRefreshSummary {
  refreshed: string[];
  removed: string[];
  paths: string[];
}

export async function refreshAllSitemapSnapshots(options: {
  db: SitemapDb | undefined;
  r2?: R2Bucket;
  waitUntil?: WaitUntilFn;
  refreshMinIntervalSeconds?: number;
}): Promise<SitemapRefreshSummary> {
  const { db, r2, waitUntil } = options;
  const refreshMinIntervalSeconds = normalizeSitemapRefreshMinIntervalSeconds(
    options.refreshMinIntervalSeconds
  );
  const stats = await getSitemapIndexStats(db);
  const refreshed: string[] = [];
  const removed: string[] = [];

  const refresh = async (input: {
    cacheKey: string;
    ttl: number;
    fetcher: () => Promise<string>;
    debugTag: string;
  }) => {
    await refreshSitemapSnapshot({
      cacheKey: input.cacheKey,
      ttl: input.ttl,
      fetcher: input.fetcher,
      waitUntil,
      r2,
    });
    refreshed.push(input.debugTag);
  };

  await refresh({
    cacheKey: 'sitemap:index:xml',
    ttl: getSitemapHotCacheTtlSeconds(SITEMAP_INDEX_CACHE_TTL, refreshMinIntervalSeconds),
    debugTag: 'index',
    fetcher: async () => buildSitemapIndexXml(buildSitemapIndexEntries(stats)),
  });

  await refresh({
    cacheKey: 'sitemap:core:xml',
    ttl: getSitemapHotCacheTtlSeconds(SITEMAP_CORE_CACHE_TTL, refreshMinIntervalSeconds),
    debugTag: 'core',
    fetcher: async () => buildUrlSetXml(await getExpandedCoreSitemapPages(db)),
  });

  for (const kind of ['skills', 'profiles', 'orgs'] as const) {
    const recentCacheKey = `sitemap:recent:${kind}:xml`;
    await refresh({
      cacheKey: recentCacheKey,
      ttl: getSitemapHotCacheTtlSeconds(SITEMAP_DYNAMIC_CACHE_TTL, refreshMinIntervalSeconds),
      debugTag: `recent-${kind}`,
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
        }

        return buildUrlSetXml(pages);
      },
    });

    for (let page = 1; page <= stats.dynamic[kind].pages; page += 1) {
      const cacheKey = `sitemap:${kind}:${page}:xml`;
      await refresh({
        cacheKey,
        ttl: getSitemapHotCacheTtlSeconds(SITEMAP_DYNAMIC_CACHE_TTL, refreshMinIntervalSeconds),
        debugTag: `${kind}-${page}`,
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
          }

          if (pages.length === 0) {
            throw new SitemapNotFoundError();
          }

          return buildUrlSetXml(pages);
        },
      });
    }

    removed.push(...await cleanupStaleDynamicSitemapSnapshots(r2, kind, stats.dynamic[kind].pages));
  }

  return {
    refreshed,
    removed,
    paths: buildSitemapPublicPaths(stats),
  };
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
  r2?: R2Bucket;
  snapshotMaxAgeSeconds?: number;
}): Promise<Response> {
  const { cacheKey, ttl, cacheControl, fetcher, debugTag, waitUntil, r2 } = options;
  const snapshotMaxAgeSeconds = options.snapshotMaxAgeSeconds ?? ttl;

  try {
    const cached = await peekCachedText(cacheKey, { waitUntil });
    if (cached !== null) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': cacheControl,
          'X-Cache': 'HIT',
          'X-Sitemap': debugTag,
        },
      });
    }

    const snapshot = await readSitemapSnapshot(r2, cacheKey);
    if (snapshot) {
      const generatedAt = snapshot.generatedAt;
      const isFresh = generatedAt !== undefined && (Date.now() - generatedAt) <= snapshotMaxAgeSeconds * 1000;

      await putCachedText(cacheKey, snapshot.xml, ttl, {
        waitUntil,
        contentType: 'application/xml; charset=utf-8',
      });

      if (!isFresh) {
        const refreshPromise = buildFreshSitemapXml({
          cacheKey,
          fetcher,
          ttl,
          waitUntil,
          r2,
        }).catch(async (error) => {
          if (error instanceof SitemapNotFoundError) {
            await Promise.all([
              deleteSitemapSnapshot(r2, cacheKey),
              invalidateCache(cacheKey),
            ]);
            return;
          }

          console.error(`Error refreshing stale sitemap ${debugTag}:`, error);
        });
        if (waitUntil) {
          waitUntil(refreshPromise);
        } else {
          void refreshPromise;
        }
      }

      return new Response(snapshot.xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': cacheControl,
          'X-Cache': isFresh ? 'SNAPSHOT' : 'STALE',
          'X-Sitemap': debugTag,
        },
      });
    }

    const xml = await buildFreshSitemapXml({
      cacheKey,
      fetcher,
      ttl,
      waitUntil,
      r2,
    });

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': cacheControl,
        'X-Cache': 'MISS',
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
