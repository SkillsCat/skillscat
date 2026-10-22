import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigratedDb } from './helpers/migrated-db';
import { QUALITY_DISCOVERY_COUNT_KEY } from '../src/lib/server/skill/quality-discovery';
import { TRENDING_SNAPSHOT_KEY } from '../src/lib/server/ranking/trending-snapshot';
import { getRecentSkillsPaginated, getTopSkillsPaginated, getTrendingSkillsPaginated } from '../src/lib/server/db/business/lists';

vi.mock('$lib/server/cache', () => ({
  getCached: vi.fn(async (_key: string, load: () => Promise<unknown>) => ({ data: await load(), hit: false })),
}));

function fixture() {
  const { sqlite, db, queries } = createMigratedDb();
  for (let i = 0; i < 3; i++) {
    sqlite.prepare(`INSERT INTO skills(id, name, slug, repo_owner, repo_name, description, quality_status)
      VALUES (?, ?, ?, 'fixture', ?, 'A local test skill', 'eligible')`).run(String(i), `Skill ${i}`, `fixture/${i}`, String(i));
    sqlite.prepare(`INSERT INTO skill_categories(skill_id, category_slug) VALUES (?, 'testing')`).run(String(i));
  }
  return { sqlite, db, queries };
}

beforeEach(() => vi.clearAllMocks());

describe('public list request waterfalls', () => {
  for (const [name, load] of [['recent', getRecentSkillsPaginated], ['top', getTopSkillsPaginated]] as const) {
    it(`${name}: hydrates categories while the full first-page count is pending`, async () => {
      const { db, queries, sqlite } = fixture();
      const count = Promise.withResolvers<R2ObjectBody | null>();
      const r2 = { get: vi.fn((key: string) => key === QUALITY_DISCOVERY_COUNT_KEY ? count.promise : Promise.resolve(null)) };
      const pending = load({ DB: db, R2: r2 as unknown as R2Bucket }, 1, 2);
      try {
        await vi.waitFor(() => expect(queries.some(({ sql }) => /FROM skill_categories/.test(sql))).toBe(true));
      } finally {
        count.resolve({ json: async () => ({ total: 3, generatedAt: Date.now() }) } as R2ObjectBody);
      }
      const result = await pending;
      expect(result.total).toBe(3);
      expect(result.skills).toHaveLength(2);
      expect(result.skills.every((skill) => skill.categories?.includes('testing'))).toBe(true);
      sqlite.close();
    });

    it(`${name}: a short first page still avoids the count read`, async () => {
      const { db, sqlite } = fixture();
      const get = vi.fn().mockResolvedValue(null);
      const result = await load({ DB: db, R2: { get } as unknown as R2Bucket }, 1, 24);
      expect(result.total).toBe(3);
      expect(get).not.toHaveBeenCalledWith(QUALITY_DISCOVERY_COUNT_KEY);
      sqlite.close();
    });
  }

  it('starts the first trending snapshot before its independent count resolves', async () => {
    const { db, sqlite } = fixture();
    const count = Promise.withResolvers<R2ObjectBody | null>();
    const get = vi.fn((key: string) => key === QUALITY_DISCOVERY_COUNT_KEY ? count.promise : Promise.resolve(null));
    const pending = getTrendingSkillsPaginated({ DB: db, R2: { get } as unknown as R2Bucket });
    try {
      await vi.waitFor(() => expect(get).toHaveBeenCalledWith(TRENDING_SNAPSHOT_KEY));
    } finally {
      count.resolve({ json: async () => ({ total: 3, generatedAt: Date.now() }) } as R2ObjectBody);
    }
    expect((await pending).skills).toHaveLength(3);
    sqlite.close();
  });

  it('does not fetch a trending snapshot for an out-of-range later page', async () => {
    const { db, sqlite } = fixture();
    const get = vi.fn().mockResolvedValue(null);
    const result = await getTrendingSkillsPaginated({ DB: db, R2: { get } as unknown as R2Bucket }, 100);
    expect(result.skills).toEqual([]);
    expect(get).not.toHaveBeenCalledWith(TRENDING_SNAPSHOT_KEY);
    sqlite.close();
  });
});
