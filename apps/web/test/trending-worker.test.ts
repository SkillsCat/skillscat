import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncCategoryPublicStatsMock } = vi.hoisted(() => ({
  syncCategoryPublicStatsMock: vi.fn(async () => {}),
}));

vi.mock('../src/lib/server/db/business/stats', () => ({
  syncCategoryPublicStats: syncCategoryPublicStatsMock,
}));

import { getSkillRefreshSelectColumns, resolveRefreshRepoMetrics } from '../workers/shared/trending/refresh';
import {
  queueTrendingHeadSecurityPremium,
  shouldRegenerateTrendingListCaches,
  syncUpdatedSkillCategoryStats,
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
