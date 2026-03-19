import { describe, expect, it } from 'vitest';
import {
  buildSitemapIndexEntries,
  getExpandedCoreSitemapPages,
  MAX_CORE_CATEGORY_SITEMAP_PAGES,
  MAX_CORE_LIST_SITEMAP_PAGES,
  PUBLIC_LIST_PAGE_SIZE,
  loadProfilesSitemapPage,
  loadRecentOrgsSitemapPages,
  loadRecentProfilesSitemapPages,
  loadRecentSkillsSitemapPages,
} from '../src/lib/server/seo/sitemap';

interface MockRow {
  count?: number;
  max_ts?: number;
  slug?: string;
}

function createDbMock(rows: {
  publicSkills: MockRow;
  categoryCounts: MockRow[];
}) {
  return {
    prepare(query: string) {
      const normalized = query.replace(/\s+/g, ' ').trim();

      if (
        normalized.includes('FROM skills') &&
        normalized.includes("WHERE visibility = 'public'") &&
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

      if (normalized.includes('FROM skill_categories sc') && normalized.includes('GROUP BY sc.category_slug')) {
        return {
          bind() {
            return {
              all: async () => ({ results: rows.categoryCounts }),
            };
          },
        };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

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
});

describe('buildSitemapIndexEntries', () => {
  it('emits recent delta sitemaps before full dynamic shards', () => {
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
      '/sitemaps/recent-orgs.xml',
      '/sitemaps/skills-1.xml',
      '/sitemaps/skills-2.xml',
      '/sitemaps/skills-3.xml',
      '/sitemaps/orgs-1.xml',
    ]);
  });
});

describe('loadRecentSkillsSitemapPages', () => {
  it('returns recently changed public skill detail urls ordered by freshness', async () => {
    const now = Date.parse('2026-03-19T00:00:00.000Z');
    const db = {
      prepare(query: string) {
        const normalized = query.replace(/\s+/g, ' ').trim();
        expect(normalized).toContain("WHERE visibility = 'public'");
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
        expect(normalized).toContain("JOIN skills s ON s.visibility = 'public' AND s.repo_owner = a.username");
        expect(normalized).toContain('CASE WHEN a.updated_at > MAX');

        return {
          bind(limit: number, offset: number) {
            expect(limit).toBe(5000);
            expect(offset).toBe(0);

            return {
              all: async () => ({
                results: [
                  {
                    username: 'backrunner',
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
        expect(normalized).toContain('WHERE freshness_ts >= ?');
        expect(normalized).toContain('ORDER BY freshness_ts DESC, username ASC');

        return {
          bind(cutoff: number, limit: number) {
            expect(cutoff).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
            expect(limit).toBe(1000);

            return {
              all: async () => ({
                results: [
                  {
                    username: 'backrunner',
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
        expect(normalized).toContain("JOIN skills s ON s.org_id = o.id AND s.visibility = 'public'");
        expect(normalized).toContain('ORDER BY freshness_ts DESC, slug ASC');

        return {
          bind(cutoff: number, limit: number) {
            expect(cutoff).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
            expect(limit).toBe(1000);

            return {
              all: async () => ({
                results: [
                  {
                    slug: 'skillscat',
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
