import { describe, expect, it } from 'vitest';

import { tryClaimSkillSecurityAnalysis } from '../src/lib/server/security/state';
import {
  getOpenRouterFreePauseUntil,
  isOpenRouterFreePauseError,
  OpenRouterApiError,
  pauseOpenRouterFreeModels,
} from '../workers/shared/ai/openrouter';
import { getTierModelCandidates } from '../workers/security-analysis';

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
