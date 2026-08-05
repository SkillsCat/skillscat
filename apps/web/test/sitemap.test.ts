import { describe, expect, it } from 'vitest';
import { MIN_INDEXABLE_DYNAMIC_CATEGORY_SKILLS } from '../src/lib/seo/constants';
import {
  buildSitemapCacheControl,
  buildSitemapIndexEntries,
  buildSitemapPriorityPaths,
  buildSitemapPublicPaths,
  getExpandedCoreSitemapPages,
  getSitemapHotCacheTtlSeconds,
  getSitemapSharedMaxAgeSeconds,
  MAX_CORE_CATEGORY_SITEMAP_PAGES,
  MAX_CORE_DYNAMIC_CATEGORIES,
  MAX_CORE_LIST_SITEMAP_PAGES,
  PUBLIC_LIST_PAGE_SIZE,
  SITEMAP_DYNAMIC_BROWSER_MAX_AGE_SECONDS,
  SITEMAP_DYNAMIC_CACHE_TTL,
  SITEMAP_DYNAMIC_SHARED_MAX_AGE_SECONDS,
  SITEMAP_DYNAMIC_STALE_WHILE_REVALIDATE_SECONDS,
  SITEMAP_RECENT_CACHE_TTL,
  SITEMAP_URL_LIMIT,
  loadProfilesSitemapPage,
  loadRecentOrgsSitemapPages,
  loadRecentProfilesSitemapPages,
  loadRecentSkillsSitemapPages,
  parseDynamicSitemapSnapshotPage,
} from '../src/lib/server/seo/sitemap';

interface MockRow {
  count?: number;
  max_ts?: number;
  slug?: string;
}

function createDbMock(rows: {
  publicSkills: MockRow;
  categoryCounts: MockRow[];
  dynamicCategoryCounts?: MockRow[];
}) {
  const queries: string[] = [];
  return {
    queries,
    prepare(query: string) {
      const normalized = query.replace(/\s+/g, ' ').trim();
      queries.push(normalized);

      if (
        normalized.includes('FROM skills') &&
        normalized.includes('COUNT(*) AS count') &&
        !normalized.includes('GROUP BY')
      ) {
        return {
          bind() {
            return {
              first: async () => rows.publicSkills,
            };
          },
        };
      }

      if (normalized.includes('FROM category_public_stats') && normalized.includes('public_skill_count AS count')) {
        return {
          bind() {
            return {
              all: async () => ({ results: rows.categoryCounts }),
            };
          },
        };
      }

      if (normalized.includes('FROM categories c INDEXED BY categories_ai_suggested_skill_count_idx')) {
        return {
          bind(minCategorySkills: number, minPublicSkills: number, limit: number) {
            expect(minCategorySkills).toBe(MIN_INDEXABLE_DYNAMIC_CATEGORY_SKILLS);
            expect(minPublicSkills).toBe(MIN_INDEXABLE_DYNAMIC_CATEGORY_SKILLS);
            expect(limit).toBe(MAX_CORE_DYNAMIC_CATEGORIES);
            return {
              all: async () => ({ results: rows.dynamicCategoryCounts || [] }),
            };
          },
        };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

describe('dynamic sitemap snapshot keys', () => {
  it('parses the versioned R2 object shape used by snapshot persistence', () => {
    expect(parseDynamicSitemapSnapshotPage(
      'cache/sitemaps/v2/sitemap:v2:skills:6:xml.xml',
      'skills'
    )).toBe(6);
    expect(parseDynamicSitemapSnapshotPage(
      'cache/sitemaps/v2/sitemap:v2:profiles:2:xml.xml',
      'skills'
    )).toBeNull();
    expect(parseDynamicSitemapSnapshotPage(
      'cache/sitemaps/v1/sitemap:skills:6:xml.xml',
      'skills'
    )).toBeNull();
  });
});

describe('getExpandedCoreSitemapPages', () => {
  it('adds paginated collection pages for high-value public lists', async () => {
    const totalItems = PUBLIC_LIST_PAGE_SIZE * (MAX_CORE_LIST_SITEMAP_PAGES + 4);
    const db = createDbMock({
      publicSkills: {
        count: totalItems,
        max_ts: Date.parse('2026-03-10T00:00:00.000Z'),
      },
      categoryCounts: [],
    });

    const pages = await getExpandedCoreSitemapPages(db as never);

    expect(pages.some((page) => page.url === '/docs')).toBe(true);
    expect(pages.some((page) => page.url === '/docs/cli')).toBe(true);
    expect(pages.some((page) => page.url === '/docs/openclaw')).toBe(true);
    expect(pages.some((page) => page.url === '/trending?page=2')).toBe(true);
    expect(pages.some((page) => page.url === `/trending?page=${MAX_CORE_LIST_SITEMAP_PAGES}`)).toBe(true);
    expect(pages.some((page) => page.url === `/trending?page=${MAX_CORE_LIST_SITEMAP_PAGES + 1}`)).toBe(false);
    expect(pages.some((page) => page.url === '/recent?page=2')).toBe(true);
    expect(pages.some((page) => page.url === '/top?page=2')).toBe(true);
    expect(pages.some((page) => page.url === '/category/seo')).toBe(false);
    expect(db.queries[0]).toContain('INDEXED BY skills_public_openclaw_updated_slug_idx');
    expect(db.queries[0]).toContain('LIMIT ?');
  });

  it('only includes predefined category pages that have public skills and caps depth', async () => {
    const db = createDbMock({
      publicSkills: {
        count: PUBLIC_LIST_PAGE_SIZE * 3,
        max_ts: Date.parse('2026-03-10T00:00:00.000Z'),
      },
      categoryCounts: [
        {
          slug: 'seo',
          count: PUBLIC_LIST_PAGE_SIZE * (MAX_CORE_CATEGORY_SITEMAP_PAGES + 3),
          max_ts: Date.parse('2026-03-09T00:00:00.000Z'),
        },
      ],
    });

    const pages = await getExpandedCoreSitemapPages(db as never);

    expect(pages.some((page) => page.url === '/category/seo')).toBe(true);
    expect(pages.some((page) => page.url === '/category/seo?page=2')).toBe(true);
    expect(pages.some((page) => page.url === `/category/seo?page=${MAX_CORE_CATEGORY_SITEMAP_PAGES}`)).toBe(true);
    expect(pages.some((page) => page.url === `/category/seo?page=${MAX_CORE_CATEGORY_SITEMAP_PAGES + 1}`)).toBe(false);
    expect(pages.some((page) => page.url === '/category/security')).toBe(false);
  });

  it('includes bounded dynamic categories from precomputed public stats', async () => {
    const db = createDbMock({
      publicSkills: {
        count: PUBLIC_LIST_PAGE_SIZE,
        max_ts: Date.parse('2026-03-10T00:00:00.000Z'),
      },
      categoryCounts: [],
      dynamicCategoryCounts: [
        {
          slug: 'agent memory',
          count: PUBLIC_LIST_PAGE_SIZE * 2,
          max_ts: Date.parse('2026-03-11T00:00:00.000Z'),
        },
      ],
    });

    const pages = await getExpandedCoreSitemapPages(db as never);

    expect(pages).toContainEqual({
      url: '/category/agent%20memory',
      priority: '0.65',
      changefreq: 'daily',
      lastmod: '2026-03-11',
    });
    expect(pages.some((page) => page.url === '/category/agent%20memory?page=2')).toBe(true);
    expect(db.queries.some((query) => query.includes('LIMIT ?'))).toBe(true);
  });
});

describe('buildSitemapIndexEntries', () => {
  it('keeps recent delta sitemap urls stable before full dynamic shards', () => {
    const entries = buildSitemapIndexEntries({
      dynamic: {
        skills: { count: 10001, pages: 3, lastmod: '2026-03-18' },
        profiles: { count: 0, pages: 0 },
        orgs: { count: 1, pages: 1, lastmod: '2026-03-17' },
      },
      recent: {
        skills: { count: 8, lastmod: '2026-03-19' },
        profiles: { count: 0 },
        orgs: { count: 2, lastmod: '2026-03-18' },
      },
    });

    expect(entries.map((entry) => entry.url)).toEqual([
      '/sitemaps/core.xml',
      '/sitemaps/recent-skills.xml',
      '/sitemaps/skills-1.xml',
      '/sitemaps/skills-2.xml',
      '/sitemaps/skills-3.xml',
      '/sitemaps/orgs-1.xml',
    ]);
  });
});

describe('sitemap cache warmup settings', () => {
  it('keeps full shards for a day while recent deltas follow the hourly refresh interval', () => {
    expect(getSitemapHotCacheTtlSeconds(SITEMAP_DYNAMIC_CACHE_TTL, 3600)).toBe(86400);
    expect(getSitemapHotCacheTtlSeconds(SITEMAP_RECENT_CACHE_TTL, 3600)).toBe(3900);
    expect(getSitemapHotCacheTtlSeconds(SITEMAP_RECENT_CACHE_TTL, 600)).toBe(900);
  });

  it('extends shared cache control to cover the refresh interval', () => {
    const cacheControl = buildSitemapCacheControl({
      browserMaxAgeSeconds: SITEMAP_DYNAMIC_BROWSER_MAX_AGE_SECONDS,
      sharedMaxAgeSeconds: getSitemapSharedMaxAgeSeconds(
        SITEMAP_DYNAMIC_SHARED_MAX_AGE_SECONDS,
        3600
      ),
      staleWhileRevalidateSeconds: SITEMAP_DYNAMIC_STALE_WHILE_REVALIDATE_SECONDS,
    });

    expect(cacheControl).toBe(
      'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
    );
  });

  it('includes every public sitemap path for route prewarming', () => {
    expect(buildSitemapPublicPaths({
      dynamic: {
        skills: { count: 10001, pages: 3, lastmod: '2026-03-18' },
        profiles: { count: 0, pages: 0 },
        orgs: { count: 1, pages: 1, lastmod: '2026-03-17' },
      },
      recent: {
        skills: { count: 8, lastmod: '2026-03-19' },
        profiles: { count: 0 },
        orgs: { count: 2, lastmod: '2026-03-18' },
      },
    })).toEqual([
      '/sitemap.xml',
      '/sitemaps/core.xml',
      '/sitemaps/recent-skills.xml',
      '/sitemaps/skills-1.xml',
      '/sitemaps/skills-2.xml',
      '/sitemaps/skills-3.xml',
      '/sitemaps/orgs-1.xml',
    ]);
  });

  it('prewarms only core and recent deltas during hourly refreshes', () => {
    expect(buildSitemapPriorityPaths()).toEqual([
      '/sitemaps/core.xml',
      '/sitemaps/recent-skills.xml',
    ]);
  });
});

describe('loadRecentSkillsSitemapPages', () => {
  it('returns recently changed public skill detail urls ordered by freshness', async () => {
    const now = Date.parse('2026-03-19T00:00:00.000Z');
    const db = {
      prepare(query: string) {
        const normalized = query.replace(/\s+/g, ' ').trim();
        expect(normalized).toContain("s.visibility = 'public'");
        expect(normalized).toContain("TRIM(COALESCE(s.description, '')) <> ''");
        expect(normalized).toContain('INDEXED BY skills_public_openclaw_updated_slug_idx');
        expect(normalized).toContain('ORDER BY sort_ts DESC, slug ASC');

        return {
          bind(cutoff: number, limit: number) {
            expect(cutoff).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
            expect(limit).toBe(1000);

            return {
              all: async () => ({
                results: [
                  {
                    slug: 'backrunner/alpha',
                    updated_at: null,
                    indexed_at: null,
                    last_commit_at: Date.parse('2026-03-18T00:00:00.000Z'),
                    sort_ts: Date.parse('2026-03-18T00:00:00.000Z'),
                  },
                  {
                    slug: 'backrunner/beta',
                    updated_at: Date.parse('2026-03-17T00:00:00.000Z'),
                    indexed_at: Date.parse('2026-03-16T00:00:00.000Z'),
                    last_commit_at: null,
                    sort_ts: Date.parse('2026-03-17T00:00:00.000Z'),
                  },
                ],
              }),
            };
          },
        };
      },
    };

    const pages = await loadRecentSkillsSitemapPages(db as never, now);

    expect(pages).toEqual([
      {
        url: '/skills/backrunner/alpha',
        priority: '0.7',
        changefreq: 'daily',
        lastmod: '2026-03-18',
      },
      {
        url: '/skills/backrunner/beta',
        priority: '0.7',
        changefreq: 'daily',
        lastmod: '2026-03-17',
      },
    ]);
  });
});

describe('profile and org sitemap freshness', () => {
  it('uses aggregated public skill freshness for profile pages', async () => {
    const db = {
      prepare(query: string) {
        const normalized = query.replace(/\s+/g, ' ').trim();
        expect(normalized).toContain('SELECT a.username AS entity_label');
        expect(normalized).toContain('WITH skill_freshness AS (');
        expect(normalized).toContain('INDEXED BY skills_public_repo_owner_sitemap_freshness_idx');
        expect(normalized).toContain("WHERE s.visibility = 'public' AND COALESCE(s.tier, 'cold') <> 'archived'");
        expect(normalized).toContain("TRIM(COALESCE(s.description, '')) <> '' OR TRIM(COALESCE(s.readme, '')) <> ''");
        expect(normalized).toContain('s.repo_owner IS NOT NULL');
        expect(normalized).toContain('JOIN skill_freshness sf ON sf.entity_key = a.username');
        expect(normalized).toContain('ORDER BY entity_label ASC');

        return {
          bind(limit: number, offset: number) {
            expect(limit).toBe(SITEMAP_URL_LIMIT);
            expect(offset).toBe(0);

            return {
              all: async () => ({
                results: [
                  {
                    entity_label: 'backrunner',
                    freshness_ts: Date.parse('2026-03-18T00:00:00.000Z'),
                  },
                ],
              }),
            };
          },
        };
      },
    };

    const pages = await loadProfilesSitemapPage(db as never, 1);

    expect(pages).toEqual([
      {
        url: '/u/backrunner',
        priority: '0.5',
        changefreq: 'weekly',
        lastmod: '2026-03-18',
      },
    ]);
  });

  it('uses aggregated public skill freshness for recent profile pages', async () => {
    const now = Date.parse('2026-03-19T00:00:00.000Z');
    const db = {
      prepare(query: string) {
        const normalized = query.replace(/\s+/g, ' ').trim();
        expect(normalized).toContain('SELECT a.username AS entity_label');
        expect(normalized).toContain('a.updated_at >= ?');
        expect(normalized).toContain('INDEXED BY skills_public_repo_owner_sitemap_freshness_idx');
        expect(normalized).toContain('ORDER BY freshness_ts DESC, entity_label ASC');

        return {
          bind(cutoffForAuthor: number, cutoffForSkill: number, limit: number) {
            expect(cutoffForAuthor).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
            expect(cutoffForSkill).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
            expect(limit).toBe(1000);

            return {
              all: async () => ({
                results: [
                  {
                    entity_label: 'backrunner',
                    freshness_ts: Date.parse('2026-03-18T00:00:00.000Z'),
                  },
                ],
              }),
            };
          },
        };
      },
    };

    const pages = await loadRecentProfilesSitemapPages(db as never, now);

    expect(pages).toEqual([
      {
        url: '/u/backrunner',
        priority: '0.6',
        changefreq: 'daily',
        lastmod: '2026-03-18',
      },
    ]);
  });

  it('uses aggregated public skill freshness for recent org pages', async () => {
    const now = Date.parse('2026-03-19T00:00:00.000Z');
    const db = {
      prepare(query: string) {
        const normalized = query.replace(/\s+/g, ' ').trim();
        expect(normalized).toContain('SELECT o.slug AS entity_label');
        expect(normalized).toContain('WITH skill_freshness AS (');
        expect(normalized).toContain('INDEXED BY skills_public_org_sitemap_freshness_idx');
        expect(normalized).toContain("WHERE s.visibility = 'public' AND COALESCE(s.tier, 'cold') <> 'archived'");
        expect(normalized).toContain("TRIM(COALESCE(s.description, '')) <> '' OR TRIM(COALESCE(s.readme, '')) <> ''");
        expect(normalized).toContain('s.org_id IS NOT NULL');
        expect(normalized).toContain('JOIN skill_freshness sf ON sf.entity_key = o.id');
        expect(normalized).toContain('ORDER BY freshness_ts DESC, entity_label ASC');

        return {
          bind(cutoffForOrg: number, cutoffForSkill: number, limit: number) {
            expect(cutoffForOrg).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
            expect(cutoffForSkill).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
            expect(limit).toBe(1000);

            return {
              all: async () => ({
                results: [
                  {
                    entity_label: 'skillscat',
                    freshness_ts: Date.parse('2026-03-17T00:00:00.000Z'),
                  },
                ],
              }),
            };
          },
        };
      },
    };

    const pages = await loadRecentOrgsSitemapPages(db as never, now);

    expect(pages).toEqual([
      {
        url: '/org/skillscat',
        priority: '0.65',
        changefreq: 'daily',
        lastmod: '2026-03-17',
      },
    ]);
  });
});
