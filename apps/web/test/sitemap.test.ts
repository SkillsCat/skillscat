import { describe, expect, it } from 'vitest';
import {
  getExpandedCoreSitemapPages,
  MAX_CORE_CATEGORY_SITEMAP_PAGES,
  MAX_CORE_LIST_SITEMAP_PAGES,
  PUBLIC_LIST_PAGE_SIZE,
} from '../src/lib/server/sitemap';

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

    expect(pages.some((page) => page.url === '/trending?page=2')).toBe(true);
    expect(pages.some((page) => page.url === `/trending?page=${MAX_CORE_LIST_SITEMAP_PAGES}`)).toBe(true);
    expect(pages.some((page) => page.url === `/trending?page=${MAX_CORE_LIST_SITEMAP_PAGES + 1}`)).toBe(false);
    expect(pages.some((page) => page.url === '/recent?page=2')).toBe(true);
    expect(pages.some((page) => page.url === '/top?page=2')).toBe(true);
  });

  it('adds paginated predefined category pages but caps depth', async () => {
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

    expect(pages.some((page) => page.url === '/category/seo?page=2')).toBe(true);
    expect(pages.some((page) => page.url === `/category/seo?page=${MAX_CORE_CATEGORY_SITEMAP_PAGES}`)).toBe(true);
    expect(pages.some((page) => page.url === `/category/seo?page=${MAX_CORE_CATEGORY_SITEMAP_PAGES + 1}`)).toBe(false);
  });
});
