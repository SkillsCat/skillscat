import { describe, expect, it, vi } from 'vitest';

import { getTopSkillsPaginated } from '../src/lib/server/db/business/lists';
import { getStats } from '../src/lib/server/db/business/stats';

function createR2(entries: Record<string, string> = {}): R2Bucket {
  const store = new Map(Object.entries(entries));

  return {
    get: vi.fn(async (key: string) => {
      const value = store.get(key);
      if (value === undefined) return null;

      return {
        text: async () => value,
      } as R2ObjectBody;
    }),
    put: vi.fn(async (key: string, value: string | ReadableStream | ArrayBuffer) => {
      store.set(key, typeof value === 'string' ? value : String(value));
      return null;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as R2Bucket;
}

function createSkill(index: number) {
  return {
    id: `skill-${index}`,
    name: `Cached Skill ${index}`,
    slug: `owner/cached-skill-${index}`,
    description: null,
    repoOwner: 'owner',
    repoName: `repo-${index}`,
    stars: 120 - index,
    forks: 3,
    trendingScore: 8,
    updatedAt: Date.now(),
    authorAvatar: null,
  };
}

describe('public stats cache', () => {
  it('serves public skill totals from R2 without counting skills', async () => {
    const r2 = createR2({
      'cache/lists/test/stats/public.json': JSON.stringify({
        data: { totalSkills: 42 },
        generatedAt: Date.now(),
      }),
    });
    const db = {
      prepare: vi.fn(() => {
        throw new Error('D1 count should not run');
      }),
    };

    await expect(getStats({ DB: db as never, R2: r2, CACHE_VERSION: 'test' }))
      .resolves.toEqual({ totalSkills: 42 });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('serves public skill totals from R2 without a DB binding', async () => {
    const r2 = createR2({
      'cache/lists/test/stats/public.json': JSON.stringify({
        data: { totalSkills: 42 },
        generatedAt: Date.now(),
      }),
    });

    await expect(getStats({ R2: r2, CACHE_VERSION: 'test' }))
      .resolves.toEqual({ totalSkills: 42 });
  });

  it('uses the R2 top list for the first top-rated page', async () => {
    const now = Date.now();
    const cachedSkills = Array.from({ length: 24 }, (_, index) => createSkill(index + 1));
    const r2 = createR2({
      'cache/lists/test/top.json': JSON.stringify({
        data: cachedSkills,
        generatedAt: now,
      }),
      'cache/lists/test/stats/public.json': JSON.stringify({
        data: { totalSkills: 42 },
        generatedAt: now,
      }),
    });
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM skill_categories')) {
          return {
            bind: () => ({
              all: async () => ({
                results: [
                  { skill_id: 'skill-1', category_slug: 'automation' },
                ],
              }),
            }),
          };
        }

        throw new Error(`Unexpected D1 query: ${sql}`);
      }),
    };

    const result = await getTopSkillsPaginated(
      { DB: db as never, R2: r2, CACHE_VERSION: 'test' },
      1,
      24
    );

    expect(result.total).toBe(42);
    expect(result.skills).toHaveLength(24);
    expect(result.skills[0].categories).toEqual(['automation']);
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('falls back to D1 when a cached first page is incomplete', async () => {
    const now = Date.now();
    const liveRows = Array.from({ length: 25 }, (_, index) => createSkill(index + 1));
    const r2 = createR2({
      'cache/lists/test/top.json': JSON.stringify({
        data: [createSkill(1)],
        generatedAt: now,
      }),
      'cache/lists/test/stats/public.json': JSON.stringify({
        data: { totalSkills: 42 },
        generatedAt: now,
      }),
    });
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM skills INDEXED BY skills_top_public_rank_expr_idx')) {
          return {
            bind: () => ({
              all: async () => ({ results: liveRows }),
            }),
          };
        }

        if (sql.includes('FROM skill_categories')) {
          return {
            bind: () => ({
              all: async () => ({ results: [] }),
            }),
          };
        }

        throw new Error(`Unexpected D1 query: ${sql}`);
      }),
    };

    const result = await getTopSkillsPaginated(
      { DB: db as never, R2: r2, CACHE_VERSION: 'test' },
      1,
      24
    );

    expect(result.total).toBe(42);
    expect(result.skills).toHaveLength(24);
    expect(db.prepare).toHaveBeenCalledTimes(2);
  });
});
