import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncCategoryPublicStatsMock } = vi.hoisted(() => ({
  syncCategoryPublicStatsMock: vi.fn(async () => {}),
}));

vi.mock('../src/lib/server/db/business/stats', () => ({
  syncCategoryPublicStats: syncCategoryPublicStatsMock,
}));

import { getSkillRefreshSelectColumns, resolveRefreshRepoMetrics } from '../workers/shared/trending/refresh';
import {
  detectReclassificationNeeded,
  loadRepoSiblingRefreshUpdates,
  queueTrendingHeadSecurityPremium,
  shouldRegenerateTrendingListCaches,
  syncUpdatedSkillCategoryStats,
  syncUpdatedSkillCategoryStatsOncePerDay,
} from '../workers/trending';
import type { SkillRecord } from '../workers/shared/types';

type RefreshSkill = Pick<SkillRecord, 'id' | 'stars' | 'forks' | 'last_commit_at'>;

const baseSkill: RefreshSkill = {
  id: 'skill-1',
  stars: 123,
  forks: 17,
  last_commit_at: 1_700_000_000_000,
};

beforeEach(() => {
  syncCategoryPublicStatsMock.mockClear();
});

describe('getSkillRefreshSelectColumns', () => {
  it('selects forks for refresh fallbacks', () => {
    expect(getSkillRefreshSelectColumns()).toContain('forks');
  });
});

describe('resolveRefreshRepoMetrics', () => {
  it('keeps stored metrics when GitHub metadata is unavailable', () => {
    expect(resolveRefreshRepoMetrics(baseSkill, null)).toEqual({
      stars: 123,
      forks: 17,
      lastCommitAt: 1_700_000_000_000,
    });
  });

  it('keeps the stored last commit timestamp when pushedAt is null', () => {
    expect(resolveRefreshRepoMetrics(baseSkill, {
      stargazerCount: 150,
      forkCount: 23,
      pushedAt: null,
    })).toEqual({
      stars: 150,
      forks: 23,
      lastCommitAt: 1_700_000_000_000,
    });
  });

  it('refuses to build an update when fallback metrics are missing', () => {
    const incompleteSkill = {
      ...baseSkill,
      forks: undefined,
    } as unknown as RefreshSkill;

    expect(resolveRefreshRepoMetrics(incompleteSkill, null)).toBeNull();
  });
});

class SqliteD1Statement {
  private params: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async all<T>() {
    const results = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results };
  }
}

class SqliteD1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }

  async batch<T>(statements: SqliteD1Statement[]) {
    return Promise.all(statements.map((statement) => statement.all<T>()));
  }
}

function createRepoMetricsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      repo_owner TEXT,
      repo_name TEXT,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      star_snapshots TEXT,
      indexed_at INTEGER NOT NULL,
      last_commit_at INTEGER,
      tier TEXT NOT NULL DEFAULT 'cold',
      last_accessed_at INTEGER,
      access_count_7d INTEGER NOT NULL DEFAULT 0,
      download_count_7d INTEGER NOT NULL DEFAULT 0,
      next_update_at INTEGER,
      source_type TEXT DEFAULT 'github'
    );
  `);
  return db;
}

describe('loadRepoSiblingRefreshUpdates', () => {
  it('recomputes all derived fields for changed skills from the same repository', async () => {
    const sqlite = createRepoMetricsDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, repo_owner, repo_name, stars, forks, star_snapshots, indexed_at,
        last_commit_at, tier, last_accessed_at, access_count_7d,
        download_count_7d, next_update_at, source_type
      ) VALUES
        ('selected', 'backrunner', 'skillscat', 42, 8, '[]', 1700000000000, 1700000000000, 'cool', NULL, 0, 0, NULL, 'github'),
        ('nested', 'backrunner', 'skillscat', 17, 3, 'not-json', 1700000000000, 1700000000000, 'cool', NULL, 0, 0, NULL, 'github'),
        ('archived', 'backrunner', 'skillscat', 17, 3, '[]', 1700000000000, 1700000000000, 'archived', NULL, 0, 0, NULL, 'github'),
        ('upload', 'backrunner', 'skillscat', 99, 20, '[]', 1700000000000, 1700000000000, 'cool', NULL, 0, 0, NULL, 'upload'),
        ('other', 'backrunner', 'another', 5, 1, '[]', 1700000000000, 1700000000000, 'cold', NULL, 0, 0, NULL, 'github');
    `);

    const updates = await loadRepoSiblingRefreshUpdates(
      new SqliteD1Database(sqlite) as never,
      [{
        owner: 'backrunner',
        name: 'skillscat',
        stars: 42,
        forks: 8,
        pushedAt: '2026-07-15T00:00:00Z',
      }],
      ['selected']
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: 'nested',
      stars: 42,
      forks: 8,
      tier: 'cool',
    });
    expect(updates[0]?.score).toBeGreaterThan(0);
    expect(updates[0]?.nextUpdateAt).toBeGreaterThan(Date.now());
    expect(JSON.parse(updates[0]?.starSnapshots || '[]')).toContainEqual(
      expect.objectContaining({ s: 42 })
    );
  });
});

describe('queueTrendingHeadSecurityPremium', () => {
  it('skips queueing when the binding is unavailable', async () => {
    expect(await queueTrendingHeadSecurityPremium({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
    } as never)).toBe(0);
  });

  it('queues premium analysis for trending head skills missing premium coverage', async () => {
    const sent: unknown[] = [];
    const premiumDueWrites: Array<{ skillId: string; contentFingerprint: string; reason: string }> = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            if (sql.includes('WITH trending_head AS')) {
              return {
                all: async () => ({
                  results: [
                    {
                      id: 'skill-a',
                      contentFingerprint: 'fp-a',
                      premiumRequestedFingerprint: null,
                      premiumLastAnalyzedFingerprint: null,
                    },
                    {
                      id: 'skill-b',
                      contentFingerprint: 'fp-b',
                      premiumRequestedFingerprint: null,
                      premiumLastAnalyzedFingerprint: null,
                    },
                  ],
                }),
              };
            }

            if (sql.includes('INSERT INTO skill_security_state')) {
              premiumDueWrites.push({
                skillId: String(args[0]),
                contentFingerprint: String(args[1]),
                reason: String(args[3]),
              });
              return {
                run: async () => ({ meta: { changes: 1 } }),
              };
            }

            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      },
      KV: {} as never,
      R2: {} as never,
      SECURITY_ANALYSIS_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
      },
      SECURITY_PREMIUM_TOP_N: '2',
    } as never;

    expect(await queueTrendingHeadSecurityPremium(env)).toBe(2);
    expect(sent).toEqual([
      {
        type: 'analyze_security',
        skillId: 'skill-a',
        trigger: 'trending_head',
        requestedTier: 'premium',
      },
      {
        type: 'analyze_security',
        skillId: 'skill-b',
        trigger: 'trending_head',
        requestedTier: 'premium',
      },
    ]);
    expect(premiumDueWrites).toEqual([
      { skillId: 'skill-a', contentFingerprint: 'fp-a', reason: 'trending_head' },
      { skillId: 'skill-b', contentFingerprint: 'fp-b', reason: 'trending_head' },
    ]);
  });

  it('skips rewrites when the current fingerprint is already queued for premium analysis', async () => {
    const sent: unknown[] = [];
    const premiumDueWrites: Array<{ skillId: string; contentFingerprint: string; reason: string }> = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            if (sql.includes('WITH trending_head AS')) {
              return {
                all: async () => ({
                  results: [
                    {
                      id: 'skill-a',
                      contentFingerprint: 'fp-a',
                      premiumRequestedFingerprint: 'fp-a',
                      premiumLastAnalyzedFingerprint: null,
                    },
                    {
                      id: 'skill-b',
                      contentFingerprint: 'fp-b',
                      premiumRequestedFingerprint: null,
                      premiumLastAnalyzedFingerprint: null,
                    },
                  ],
                }),
              };
            }

            if (sql.includes('INSERT INTO skill_security_state')) {
              premiumDueWrites.push({
                skillId: String(args[0]),
                contentFingerprint: String(args[1]),
                reason: String(args[3]),
              });
              return {
                run: async () => ({ meta: { changes: 1 } }),
              };
            }

            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      },
      KV: {} as never,
      R2: {} as never,
      SECURITY_ANALYSIS_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
      },
      SECURITY_PREMIUM_TOP_N: '2',
    } as never;

    expect(await queueTrendingHeadSecurityPremium(env)).toBe(1);
    expect(sent).toEqual([
      {
        type: 'analyze_security',
        skillId: 'skill-b',
        trigger: 'trending_head',
        requestedTier: 'premium',
      },
    ]);
    expect(premiumDueWrites).toEqual([
      { skillId: 'skill-b', contentFingerprint: 'fp-b', reason: 'trending_head' },
    ]);
  });
});

describe('detectReclassificationNeeded', () => {
  it('queues reclassification only for hot-worthy keyword-classified skills', async () => {
    const sent: unknown[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            if (sql.includes('SELECT id, repo_owner, repo_name, skill_path, stars, tier, classification_method')) {
              expect(args).toEqual(['skill-hot', 'skill-warm', 'skill-star-hot', 1000]);
              return {
                all: async () => ({
                  results: [
                    {
                      id: 'skill-hot',
                      repo_owner: 'owner',
                      repo_name: 'repo-hot',
                      skill_path: null,
                      stars: 12,
                      tier: 'hot',
                      classification_method: 'keyword',
                    },
                    {
                      id: 'skill-star-hot',
                      repo_owner: 'owner',
                      repo_name: 'repo-star-hot',
                      skill_path: 'skills/alpha',
                      stars: 1200,
                      tier: 'warm',
                      classification_method: 'keyword',
                    },
                  ],
                }),
              };
            }

            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      },
      KV: {} as never,
      R2: {} as never,
      CLASSIFICATION_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
      },
    } as never;

    expect(await detectReclassificationNeeded(env, ['skill-hot', 'skill-warm', 'skill-star-hot'])).toBe(2);
    expect(sent).toEqual([
      {
        type: 'classify',
        skillId: 'skill-hot',
        repoOwner: 'owner',
        repoName: 'repo-hot',
        skillMdPath: 'skills/github/owner/repo-hot/_root_/SKILL.md',
        stars: 12,
        tier: 'hot',
        isReclassification: true,
      },
      {
        type: 'classify',
        skillId: 'skill-star-hot',
        repoOwner: 'owner',
        repoName: 'repo-star-hot',
        skillMdPath: 'skills/github/owner/repo-star-hot/p:skills%2Falpha/SKILL.md',
        stars: 1200,
        tier: 'warm',
        isReclassification: true,
      },
    ]);
  });

  it('chunks large reclassification scans to stay below D1 variable limits', async () => {
    const bindCalls: unknown[][] = [];
    const sent: unknown[] = [];
    const updatedSkillIds = Array.from({ length: 205 }, (_, index) => `skill-${index}`);
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            if (sql.includes('SELECT id, repo_owner, repo_name, skill_path, stars, tier, classification_method')) {
              bindCalls.push(args);
              return {
                all: async () => ({ results: [] }),
              };
            }

            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      },
      KV: {} as never,
      R2: {} as never,
      CLASSIFICATION_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
      },
    } as never;

    expect(await detectReclassificationNeeded(env, updatedSkillIds)).toBe(0);
    expect(sent).toEqual([]);
    expect(bindCalls).toHaveLength(3);
    expect(bindCalls.map((args) => args.length)).toEqual([91, 91, 26]);
    expect(bindCalls.every((args) => args.length <= 100)).toBe(true);
  });
});

describe('syncUpdatedSkillCategoryStats', () => {
  it('refreshes deduped category stats for updated skills', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          if (sql.includes('SELECT DISTINCT category_slug as categorySlug')) {
            expect(args).toEqual(['skill-1', 'skill-2']);
            return {
              all: async () => ({
                results: [
                  { categorySlug: 'agents' },
                  { categorySlug: 'automation' },
                  { categorySlug: 'agents' },
                ],
              }),
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
    } as never;

    await expect(syncUpdatedSkillCategoryStats(db, ['skill-1', 'skill-2', 'skill-1'])).resolves.toEqual([
      'agents',
      'automation',
    ]);
    expect(syncCategoryPublicStatsMock).toHaveBeenCalledTimes(1);
    expect(syncCategoryPublicStatsMock).toHaveBeenCalledWith(db, ['agents', 'automation']);
  });

  it('chunks large category scans to stay below D1 variable limits', async () => {
    const bindCalls: unknown[][] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          if (sql.includes('SELECT DISTINCT category_slug as categorySlug')) {
            bindCalls.push(args);
            return {
              all: async () => ({ results: [] }),
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
    } as never;

    const skillIds = Array.from({ length: 205 }, (_, index) => `skill-${index}`);

    await expect(syncUpdatedSkillCategoryStats(db, skillIds)).resolves.toEqual([]);
    expect(bindCalls).toHaveLength(3);
    expect(bindCalls.map((args) => args.length)).toEqual([90, 90, 25]);
    expect(bindCalls.every((args) => args.length <= 90)).toBe(true);
    expect(syncCategoryPublicStatsMock).not.toHaveBeenCalled();
  });

  it('skips sync when no category rows are found', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => {
          if (sql.includes('SELECT DISTINCT category_slug as categorySlug')) {
            return {
              all: async () => ({ results: [] }),
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
    } as never;

    await expect(syncUpdatedSkillCategoryStats(db, ['skill-1'])).resolves.toEqual([]);
    expect(syncCategoryPublicStatsMock).not.toHaveBeenCalled();
  });
});

describe('syncUpdatedSkillCategoryStatsOncePerDay', () => {
  it('accumulates dirty categories and refreshes them at most once per UTC day', async () => {
    const categoriesBySkillId: Record<string, string> = {
      'skill-1': 'agents',
      'skill-2': 'automation',
      'skill-3': 'security',
    };
    const db = {
      prepare: () => ({
        bind: (...skillIds: string[]) => ({
          all: async () => ({
            results: skillIds.map((skillId) => ({
              categorySlug: categoriesBySkillId[skillId],
            })),
          }),
        }),
      }),
    };
    const values = new Map<string, string>();
    const kv = {
      get: async (key: string, type?: string) => {
        const value = values.get(key) ?? null;
        return type === 'json' && value ? JSON.parse(value) : value;
      },
      put: async (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const env = { DB: db, KV: kv } as never;

    await expect(syncUpdatedSkillCategoryStatsOncePerDay(
      env,
      ['skill-1'],
      Date.UTC(2026, 7, 27, 1)
    )).resolves.toEqual(['agents']);
    await expect(syncUpdatedSkillCategoryStatsOncePerDay(
      env,
      ['skill-2'],
      Date.UTC(2026, 7, 27, 2)
    )).resolves.toEqual([]);
    await expect(syncUpdatedSkillCategoryStatsOncePerDay(
      env,
      ['skill-3'],
      Date.UTC(2026, 7, 28, 1)
    )).resolves.toEqual(['automation', 'security']);

    expect(syncCategoryPublicStatsMock).toHaveBeenCalledTimes(2);
    expect(syncCategoryPublicStatsMock).toHaveBeenNthCalledWith(1, db, ['agents']);
    expect(syncCategoryPublicStatsMock).toHaveBeenNthCalledWith(2, db, ['automation', 'security']);
  });

  it('flushes categories carried from the previous day without requiring another skill update', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    };
    const values = new Map<string, string>([
      ['category-stats:last-sync-day', '2026-08-27'],
      ['category-stats:dirty-slugs', JSON.stringify(['automation'])],
    ]);
    const kv = {
      get: async (key: string, type?: string) => {
        const value = values.get(key) ?? null;
        return type === 'json' && value ? JSON.parse(value) : value;
      },
      put: async (key: string, value: string) => {
        values.set(key, value);
      },
    };

    await expect(syncUpdatedSkillCategoryStatsOncePerDay(
      { DB: db, KV: kv } as never,
      [],
      Date.UTC(2026, 7, 28, 1)
    )).resolves.toEqual(['automation']);

    expect(syncCategoryPublicStatsMock).toHaveBeenCalledWith(db, ['automation']);
    expect(values.get('category-stats:last-sync-day')).toBe('2026-08-28');
    expect(values.get('category-stats:dirty-slugs')).toBe('[]');
  });
});

describe('shouldRegenerateTrendingListCaches', () => {
  it('skips cache rebuilds when nothing changed', () => {
    expect(shouldRegenerateTrendingListCaches({
      markedUpdates: 0,
      hotUpdates: 0,
      warmUpdates: 0,
      coolUpdates: 0,
      downloadsFlushed: 0,
    })).toBe(false);
  });

  it('rebuilds caches when trending or download state changed', () => {
    expect(shouldRegenerateTrendingListCaches({
      markedUpdates: 0,
      hotUpdates: 1,
      warmUpdates: 0,
      coolUpdates: 0,
      downloadsFlushed: 0,
    })).toBe(true);

    expect(shouldRegenerateTrendingListCaches({
      markedUpdates: 0,
      hotUpdates: 0,
      warmUpdates: 0,
      coolUpdates: 0,
      downloadsFlushed: 3,
    })).toBe(true);
  });
});
