import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  getCached: mocks.getCached,
  invalidateCache: mocks.invalidateCache,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('organization page cache', () => {
  it('rechecks a cached miss so a newly created organization is immediately visible', async () => {
    mocks.getCached.mockResolvedValue({ data: null, hit: true });
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('SELECT 1') && sql.includes('FROM organizations')) {
              return { found: 1 };
            }
            if (sql.includes('FROM organizations o')) {
              return {
                id: 'org-1',
                name: 'acme',
                slug: 'acme',
                display_name: 'Acme',
                description: null,
                avatar_url: null,
                verified_at: null,
                created_at: 1,
                updated_at: 2,
                member_count: 1,
                public_skill_count: 0,
                seo_public_skill_count: 0,
              };
            }
            return null;
          },
          all: async () => ({ results: [] }),
        }),
      })),
    };

    const { resolveOrgPagePayload } = await import('../src/lib/server/org/page');
    const result = await resolveOrgPagePayload({
      db: db as never,
      locals: { auth: async () => ({ user: null }) } as never,
    }, 'acme');

    expect(result.status).toBe(200);
    expect(result.cacheStatus).toBe('MISS');
    expect(result.data.org?.slug).toBe('acme');
    expect(mocks.invalidateCache).toHaveBeenCalledWith('page:org:snapshot:v1:acme');
  });

  it('refetches a positive snapshot when a cached skill is no longer public', async () => {
    mocks.getCached.mockResolvedValue({
      data: {
        slug: 'acme',
        org: {
          id: 'org-1',
          name: 'acme',
          slug: 'acme',
          displayName: 'Acme',
          description: null,
          avatarUrl: null,
          verified: false,
          createdAt: 1,
          updatedAt: 2,
          memberCount: 1,
          skillCount: 1,
          userRole: null,
        },
        members: [],
        skills: [{
          id: 'skill-1',
          name: 'Formerly Public',
          slug: 'acme/private-now',
          description: null,
          visibility: 'public',
          stars: 1,
        }],
        error: null,
        errorKind: null,
      },
      hit: true,
    });

    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('FROM organizations o')) {
              return {
                id: 'org-1',
                name: 'acme',
                slug: 'acme',
                display_name: 'Acme',
                description: null,
                avatar_url: null,
                verified_at: null,
                created_at: 1,
                updated_at: 2,
                member_count: 1,
                public_skill_count: 0,
                seo_public_skill_count: 0,
              };
            }
            return null;
          },
          all: async () => {
            if (sql.includes('LEFT JOIN skills s INDEXED BY skills_visibility_id_idx')) {
              return { results: [{ orgId: 'org-1', orgUpdatedAt: 2, skillId: null }] };
            }
            return { results: [] };
          },
        }),
      })),
    };

    const { resolveOrgPagePayload } = await import('../src/lib/server/org/page');
    const result = await resolveOrgPagePayload({
      db: db as never,
      locals: { auth: async () => ({ user: null }) } as never,
    }, 'Acme');

    expect(result.status).toBe(200);
    expect(result.cacheStatus).toBe('MISS');
    expect(result.data.skills).toEqual([]);
    expect(mocks.invalidateCache).toHaveBeenCalledWith('page:org:snapshot:v1:acme');
  });

  it('refetches an empty snapshot when a skill mutation advances the organization marker', async () => {
    mocks.getCached.mockResolvedValue({
      data: {
        slug: 'acme',
        org: {
          id: 'org-1',
          name: 'acme',
          slug: 'acme',
          displayName: 'Acme',
          description: null,
          avatarUrl: null,
          verified: true,
          createdAt: 1,
          updatedAt: 2,
          memberCount: 1,
          skillCount: 0,
          userRole: null,
        },
        members: [],
        skills: [],
        error: null,
        errorKind: null,
      },
      hit: true,
    });

    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('updated_at as updatedAt')) {
              return { id: 'org-1', updatedAt: 3 };
            }
            if (sql.includes('FROM organizations o')) {
              return {
                id: 'org-1',
                name: 'acme',
                slug: 'acme',
                display_name: 'Acme',
                description: null,
                avatar_url: null,
                verified_at: 1,
                created_at: 1,
                updated_at: 3,
                member_count: 1,
                public_skill_count: 1,
                seo_public_skill_count: 1,
              };
            }
            return null;
          },
          all: async () => sql.includes('FROM skills INDEXED BY')
            ? {
                results: [{
                  id: 'skill-new',
                  name: 'New Skill',
                  slug: 'acme/new-skill',
                  description: null,
                  visibility: 'public',
                  stars: 0,
                  updated_at: 3,
                  tier: 'hot',
                  indexed_at: 3,
                  download_count_90d: 0,
                  access_count_30d: 0,
                }],
              }
            : { results: [] },
        }),
      })),
    };

    const { resolveOrgPagePayload } = await import('../src/lib/server/org/page');
    const result = await resolveOrgPagePayload({
      db: db as never,
      locals: { auth: async () => ({ user: null }) } as never,
    }, 'acme');

    expect(result.cacheStatus).toBe('MISS');
    expect(result.data.skills).toEqual([
      expect.objectContaining({ id: 'skill-new', slug: 'acme/new-skill' }),
    ]);
    expect(mocks.invalidateCache).toHaveBeenCalledWith('page:org:snapshot:v1:acme');
  });
});
