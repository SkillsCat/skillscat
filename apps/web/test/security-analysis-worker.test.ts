import { describe, expect, it } from 'vitest';

import { tryClaimSkillSecurityAnalysis } from '../src/lib/server/security/state';
import {
  getOpenRouterFreePauseUntil,
  isOpenRouterFreePauseError,
  OpenRouterApiError,
  pauseOpenRouterFreeModels,
} from '../workers/shared/ai/openrouter';
import securityAnalysisWorker, {
  getTierModelCandidates,
  loadDueSkillIds,
  queueSecurityReindexBackfill,
} from '../workers/security-analysis';

describe('security analysis worker helpers', () => {
  it('keeps premium model selection isolated from the free model pool', () => {
    expect(getTierModelCandidates('premium', {
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      OPENROUTER_API_KEY: 'or-key',
      SECURITY_PREMIUM_MODEL: 'openai/gpt-4.1-mini',
      SECURITY_FREE_MODEL: 'openrouter/free',
      SECURITY_FREE_MODELS: 'foo/free,bar/free',
    })).toEqual(['openai/gpt-4.1-mini']);

    expect(getTierModelCandidates('free', {
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      OPENROUTER_API_KEY: 'or-key',
      SECURITY_PREMIUM_MODEL: 'openai/gpt-4.1-mini',
      SECURITY_FREE_MODEL: 'openrouter/free',
      SECURITY_FREE_MODELS: 'foo/free,bar/free',
    })).toEqual(['openrouter/free', 'foo/free', 'bar/free']);
  });

  it('claims a security analysis lease only when the state row is available', async () => {
    const runs: unknown[][] = [];
    const db = {
      prepare: (sql: string) => {
        expect(sql).toContain('INSERT INTO skill_security_state');
        expect(sql).toContain("WHERE skill_security_state.status != 'running'");
        return {
          bind: (...args: unknown[]) => {
            runs.push(args);
            return {
              run: async () => ({ meta: { changes: runs.length === 1 ? 1 : 0 } }),
            };
          },
        };
      },
    };

    expect(await tryClaimSkillSecurityAnalysis(db as never, {
      skillId: 'skill-1',
      contentFingerprint: 'fp-1',
      now: 1_000,
      leaseMs: 5_000,
    })).toBe(true);

    expect(await tryClaimSkillSecurityAnalysis(db as never, {
      skillId: 'skill-1',
      contentFingerprint: 'fp-1',
      now: 1_100,
      leaseMs: 5_000,
    })).toBe(false);

    expect(runs[0]).toEqual(['skill-1', 'fp-1', 6_000, 1_000, 1_000, 1_000]);
  });

  it('filters scheduled security candidates to skills with analyzable content', async () => {
    const sqls: string[] = [];
    const db = {
      prepare: (sql: string) => {
        sqls.push(sql);
        return {
          bind: (...args: unknown[]) => {
            if (sql.includes('FROM skill_security_state ss')) {
              expect(args).toEqual([5_000, 10]);
              return {
                all: async () => ({
                  results: [{ id: 'skill-dirty' }],
                }),
              };
            }

            expect(sql).toContain('WHERE ss.skill_id IS NULL');
            expect(args).toEqual([9]);
            return {
              all: async () => ({
                results: [{ id: 'skill-missing' }],
              }),
            };
          },
        };
      },
    };

    expect(await loadDueSkillIds(db as never, 5_000, 10)).toEqual(['skill-dirty', 'skill-missing']);
    expect(sqls[0]).toContain('INNER JOIN skills s ON s.id = ss.skill_id');
    expect(sqls[0]).toContain("ss.content_fingerprint IS NOT NULL");
    expect(sqls[0]).toContain("COALESCE(s.file_structure, '') != ''");
    expect(sqls[0]).toContain("COALESCE(s.readme, '') != ''");
    expect(sqls[1]).toContain("WHERE ss.skill_id IS NULL");
    expect(sqls[1]).toContain("COALESCE(s.file_structure, '') != ''");
    expect(sqls[1]).toContain("COALESCE(s.readme, '') != ''");
  });

  it('acks queue messages when the skill content is not indexed yet', async () => {
    const writes: Array<{ skillId: string; errorMessage: string }> = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('FROM skills s')) {
            return {
              bind: () => ({
                first: async () => ({
                  id: 'skill-1',
                  slug: 'owner/skill-1',
                  repo_owner: 'owner',
                  repo_name: 'repo',
                  skill_path: null,
                  readme: null,
                  visibility: 'public',
                  source_type: 'github',
                  stars: 10,
                  trending_score: 1,
                  tier: 'cool',
                  file_structure: null,
                  updated_at: 1_000,
                  skill_id: null,
                }),
              }),
            };
          }

          if (sql.includes('INSERT INTO skill_security_state')) {
            return {
              bind: (...args: unknown[]) => {
                writes.push({
                  skillId: String(args[0]),
                  errorMessage: String(args[1]),
                });
                return {
                  run: async () => ({ meta: { changes: 1 } }),
                };
              },
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
      KV: {} as never,
      R2: {} as never,
    } as never;

    let acked = 0;
    let retried = 0;
    await securityAnalysisWorker.queue({
      messages: [{
        id: 'msg-1',
        body: {
          type: 'analyze_security',
          skillId: 'skill-1',
          trigger: 'manual',
          requestedTier: 'auto',
        },
        ack: () => {
          acked += 1;
        },
        retry: () => {
          retried += 1;
        },
      }],
    } as never, env, {} as never);

    expect(acked).toBe(1);
    expect(retried).toBe(0);
    expect(writes).toEqual([{
      skillId: 'skill-1',
      errorMessage: 'Security analysis blocked until indexed content is available for skill skill-1',
    }]);
  });

  it('queues one indexing backfill per missing-source github skill snapshot', async () => {
    const sent: unknown[] = [];
    const kvStore = new Map<string, string>();
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (!sql.includes("WHERE s.source_type = 'github'")) {
            throw new Error(`Unexpected SQL: ${sql}`);
          }

          return {
            bind: (limit: unknown) => {
              expect(limit).toBe(5);
              return {
                all: async () => ({
                  results: [{
                    id: 'skill-github-1',
                    repoOwner: 'acme',
                    repoName: 'toolbox',
                    skillPath: 'agents/reviewer',
                    updatedAt: 1_000,
                  }],
                }),
              };
            },
          };
        },
      },
      KV: {
        get: async (key: string) => kvStore.get(key) ?? null,
        put: async (key: string, value: string) => {
          kvStore.set(key, value);
        },
      },
      R2: {} as never,
      INDEXING_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
      },
    } as never;

    expect(await queueSecurityReindexBackfill(env, 5)).toBe(1);
    expect(await queueSecurityReindexBackfill(env, 5)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.objectContaining({
      type: 'check_skill',
      repoOwner: 'acme',
      repoName: 'toolbox',
      skillPath: 'agents/reviewer',
      submittedBy: 'security-analysis-backfill',
      forceReindex: true,
    }));
  });

  it('shares OpenRouter free pause state across workers', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    const pauseUntil = await pauseOpenRouterFreeModels(kv as never, {
      now: 10_000,
      retryAfterMs: 30_000,
    });

    expect(pauseUntil).toBe(40_000);
    expect(await getOpenRouterFreePauseUntil(kv as never, 20_000)).toBe(40_000);
    expect(await getOpenRouterFreePauseUntil(kv as never, 50_000)).toBeNull();
    expect(isOpenRouterFreePauseError(new OpenRouterApiError({
      model: 'openrouter/free',
      status: 429,
      retryAfterMs: 30_000,
      message: 'rate limited',
    }))).toBe(true);
  });
});
