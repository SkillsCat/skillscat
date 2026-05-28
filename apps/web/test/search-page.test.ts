import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setPublicPageCache = vi.fn();
const resolveRegistrySearch = vi.fn();

vi.mock('$lib/server/cache/page', () => ({
  setPublicPageCache,
}));

vi.mock('$lib/server/registry/search', () => ({
  resolveRegistrySearch,
}));

vi.mock('$lib/constants', () => ({
  CATEGORIES: [
    {
      slug: 'research',
      name: 'Research',
      description: 'Research skills',
      keywords: ['research', 'web research'],
    },
    {
      slug: 'performance',
      name: 'Performance',
      description: 'Performance tuning skills',
      keywords: ['performance'],
    },
  ],
}));

function createInput(url: string) {
  return {
    url: new URL(url),
    platform: {
      env: {
        DB: undefined,
      },
      context: {
        waitUntil: vi.fn(),
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
});

afterEach(() => {
  vi.resetModules();
});

describe('/search page', () => {
  it('uses paginated registry search results and maps them to skill cards', async () => {
    resolveRegistrySearch.mockResolvedValue({
      data: {
        skills: [
          {
            id: 'skill-1',
            name: 'Code Researcher',
            description: 'Search codebases quickly',
            owner: 'acme',
            repo: 'code-researcher',
            stars: 42,
            updatedAt: 1710000000000,
            categories: ['research'],
            platform: 'github',
            visibility: 'public',
            slug: 'code-researcher',
            authorAvatar: 'https://img.example/acme.png',
          },
        ],
        total: 60,
      },
      cacheControl: 'public, max-age=900',
      cacheStatus: 'MISS',
    });

    const { load } = await import('../src/routes/search/+page.server');
    const result = await load(createInput('https://skills.cat/search?q=web%20research&page=2') as never);

    expect(resolveRegistrySearch).toHaveBeenCalledWith(
      expect.objectContaining({
        db: undefined,
        waitUntil: expect.any(Function),
      }),
      {
        query: 'web research',
        category: '',
        limit: 50,
        offset: 50,
        includePrivate: false,
      }
    );

    expect(result.query).toBe('web research');
    expect(result.skills).toEqual([
      expect.objectContaining({
        id: 'skill-1',
        name: 'Code Researcher',
        repoOwner: 'acme',
        repoName: 'code-researcher',
        stars: 42,
        authorAvatar: 'https://img.example/acme.png',
        categories: ['research'],
      }),
    ]);
    expect(result.pagination).toEqual({
      currentPage: 2,
      totalPages: 2,
      totalItems: 60,
      itemsPerPage: 50,
      baseUrl: '/search?q=web%20research',
    });
    expect(result.matchedCategories.map((category) => category.slug)).toEqual(['research']);
  });

  it('redirects out-of-range search pages to the last valid page', async () => {
    resolveRegistrySearch.mockResolvedValue({
      data: {
        skills: [],
        total: 48,
      },
      cacheControl: 'public, max-age=900',
      cacheStatus: 'MISS',
    });

    const { load } = await import('../src/routes/search/+page.server');

    await expect(
      load(createInput('https://skills.cat/search?q=web%20research&page=5') as never)
    ).rejects.toMatchObject({
      status: 302,
      location: '/search?q=web%20research',
    });
  });

  it('uses a URL page size that fills the active search grid columns', async () => {
    resolveRegistrySearch.mockResolvedValue({
      data: {
        skills: [],
        total: 102,
      },
      cacheControl: 'public, max-age=900',
      cacheStatus: 'MISS',
    });

    const { load } = await import('../src/routes/search/+page.server');
    const result = await load(createInput('https://skills.cat/search?q=web%20research&pageSize=51&page=2') as never);

    expect(resolveRegistrySearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: 'web research',
        limit: 51,
        offset: 51,
      })
    );

    expect(result.pagination).toEqual({
      currentPage: 2,
      totalPages: 2,
      totalItems: 102,
      itemsPerPage: 51,
      baseUrl: '/search?q=web%20research&pageSize=51',
    });
  });
});
