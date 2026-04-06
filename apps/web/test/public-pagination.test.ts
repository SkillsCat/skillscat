import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCached = vi.fn();
const setPublicPageCache = vi.fn();
const getRecentSkillsPaginated = vi.fn();
const getTrendingSkillsPaginated = vi.fn();
const getTopSkillsPaginated = vi.fn();
const getSkillsByCategoryPaginated = vi.fn();
const getCategoryBySlug = vi.fn();

vi.mock('$lib/server/cache', () => ({
  getCached,
}));

vi.mock('$lib/server/cache/page', () => ({
  setPublicPageCache,
}));

vi.mock('$lib/server/db/business/lists', () => ({
  getRecentSkillsPaginated,
  getTrendingSkillsPaginated,
  getTopSkillsPaginated,
  getSkillsByCategoryPaginated,
}));

vi.mock('$lib/constants/categories', () => ({
  CATEGORIES: [],
  getCategoryBySlug,
}));

function createBaseInput(url: string) {
  return {
    url: new URL(url),
    platform: {
      env: {
        DB: undefined,
        R2: undefined,
      },
    },
    setHeaders: vi.fn(),
    locals: {
      user: null,
    },
    request: new Request(url),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCached.mockImplementation(async (_cacheKey: string, fetcher: () => Promise<unknown>) => ({
    data: await fetcher(),
    hit: false,
  }));
});

describe('public pagination redirects', () => {
  it('redirects out-of-range recent pages to the last valid page', async () => {
    getRecentSkillsPaginated.mockResolvedValue({
      skills: [],
      total: 48,
    });

    const { load } = await import('../src/routes/recent/+page.server');

    await expect(
      load({
        ...createBaseInput('https://skills.cat/recent?page=5'),
      } as never)
    ).rejects.toMatchObject({
      status: 302,
      location: '/recent?page=2',
    });
  });

  it('redirects out-of-range trending pages to the last valid page', async () => {
    getTrendingSkillsPaginated.mockResolvedValue({
      skills: [],
      total: 72,
    });

    const { load } = await import('../src/routes/trending/+page.server');

    await expect(
      load({
        ...createBaseInput('https://skills.cat/trending?page=9'),
      } as never)
    ).rejects.toMatchObject({
      status: 302,
      location: '/trending?page=3',
    });
  });

  it('redirects out-of-range top pages to the base url when there is only one page', async () => {
    getTopSkillsPaginated.mockResolvedValue({
      skills: [],
      total: 0,
    });

    const { load } = await import('../src/routes/top/+page.server');

    await expect(
      load({
        ...createBaseInput('https://skills.cat/top?page=3'),
      } as never)
    ).rejects.toMatchObject({
      status: 302,
      location: '/top',
    });
  });

  it('redirects out-of-range category pages to the canonical last page', async () => {
    getCategoryBySlug.mockReturnValue({
      slug: 'seo',
      name: 'SEO',
      description: 'Search engine optimization skills',
      keywords: [],
    });
    getSkillsByCategoryPaginated.mockResolvedValue({
      skills: [],
      total: 0,
    });

    const { load } = await import('../src/routes/category/[slug]/+page.server');

    await expect(
      load({
        ...createBaseInput('https://skills.cat/category/seo?page=4'),
        params: {
          slug: 'seo',
        },
      } as never)
    ).rejects.toMatchObject({
      status: 302,
      location: '/category/seo',
    });
  });
});
