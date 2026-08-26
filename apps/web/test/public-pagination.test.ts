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

describe('public pagination bounds', () => {
  it('rejects pages above the public-list cost ceiling before querying D1', async () => {
    const { load } = await import('../src/routes/trending/+page.server');

    await expect(
      load({
        ...createBaseInput('https://skills.cat/trending?page=101'),
      } as never)
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(getTrendingSkillsPaginated).not.toHaveBeenCalled();
  });

  it('returns 404 for out-of-range recent pages', async () => {
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
      status: 404,
    });
  });

  it('returns 404 for out-of-range trending pages', async () => {
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
      status: 404,
    });
  });

  it('returns 404 for out-of-range top pages', async () => {
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
      status: 404,
    });
  });

  it('returns 404 for out-of-range category pages', async () => {
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
      status: 404,
    });
  });

  it('keeps single-skill dynamic category pages crawlable but out of the index', async () => {
    getCategoryBySlug.mockReturnValue(null);
    getSkillsByCategoryPaginated.mockResolvedValue({
      skills: [{ id: 'skill-1' }],
      total: 1,
    });

    const input = createBaseInput('https://skills.cat/category/very-narrow');
    input.platform.env.DB = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({
                slug: 'very-narrow',
                name: 'Very Narrow',
                description: 'A narrow dynamic category',
                type: 'ai-suggested',
              }),
            };
          },
        };
      },
    } as never;

    const { load } = await import('../src/routes/category/[slug]/+page.server');
    const result = await load({
      ...input,
      params: { slug: 'very-narrow' },
    } as never);

    expect(result).toMatchObject({
      isDynamic: true,
      shouldIndex: false,
      pagination: { totalItems: 1 },
    });
  });

  it('returns a 404 status override for empty dynamic categories', async () => {
    getCategoryBySlug.mockReturnValue(null);
    getSkillsByCategoryPaginated.mockResolvedValue({
      skills: [],
      total: 0,
    });

    const input = createBaseInput('https://skills.cat/category/empty-dynamic');
    input.platform.env.DB = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({
                slug: 'empty-dynamic',
                name: 'Empty Dynamic',
                description: 'An empty dynamic category',
                type: 'ai-suggested',
              }),
            };
          },
        };
      },
    } as never;

    const { load } = await import('../src/routes/category/[slug]/+page.server');
    const result = await load({
      ...input,
      params: { slug: 'empty-dynamic' },
    } as never);

    expect(result).toMatchObject({
      category: null,
      skills: [],
      pagination: null,
      isDynamic: true,
    });
    expect(input.setHeaders).toHaveBeenCalledWith({
      'X-Skillscat-Status-Override': '404',
    });
  });
});
