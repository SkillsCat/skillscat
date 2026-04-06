import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSkillMetricMessage,
  enqueueSkillMetric,
} from '../src/lib/server/skill/metrics';
import {
  aggregateSkillMetricMessages,
  processQueuedSkillMetrics,
} from '../workers/metrics';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('metrics worker aggregation', () => {
  it('dedupes access events and groups daily counters per skill', () => {
    const occurredAt = Date.parse('2026-04-07T01:00:00.000Z');

    const aggregated = aggregateSkillMetricMessages([
      {
        type: 'skill_metric',
        metric: 'access',
        skillId: 'skill-1',
        occurredAt,
        dedupeKey: 'skill-1:user-1',
      },
      {
        type: 'skill_metric',
        metric: 'access',
        skillId: 'skill-1',
        occurredAt: occurredAt + 1_000,
        dedupeKey: 'skill-1:user-1',
      },
      {
        type: 'skill_metric',
        metric: 'download',
        skillId: 'skill-1',
        occurredAt: occurredAt + 2_000,
      },
      {
        type: 'skill_metric',
        metric: 'install',
        skillId: 'skill-1',
        occurredAt: occurredAt + 3_000,
      },
      {
        type: 'skill_metric',
        metric: 'access',
        skillId: 'skill-2',
        occurredAt: occurredAt + 4_000,
        dedupeKey: 'skill-2:user-2',
      },
    ]);

    expect(Array.from(aggregated.accessBySkill.entries())).toEqual([
      ['skill-1', { count: 1, lastOccurredAt: occurredAt }],
      ['skill-2', { count: 1, lastOccurredAt: occurredAt + 4_000 }],
    ]);

    expect(aggregated.dailyMetrics).toEqual([
      {
        skillId: 'skill-1',
        metricDate: '2026-04-07',
        accessCount: 1,
        downloadCount: 1,
        installCount: 1,
        lastAccessedAt: occurredAt,
      },
      {
        skillId: 'skill-2',
        metricDate: '2026-04-07',
        accessCount: 1,
        downloadCount: 0,
        installCount: 0,
        lastAccessedAt: occurredAt + 4_000,
      },
    ]);
  });

  it('runs fallback recovery when queue send fails', async () => {
    const waitUntilPromises: Promise<unknown>[] = [];
    const onError = vi.fn(async () => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const queued = enqueueSkillMetric(
      {
        send: vi.fn(async () => {
          throw new Error('queue unavailable');
        }),
      } as never,
      buildSkillMetricMessage('download', 'skill-1', { occurredAt: 1 }),
      {
        waitUntil: (promise) => {
          waitUntilPromises.push(promise);
        },
        onError,
      }
    );

    expect(queued).toBe(true);
    await Promise.all(waitUntilPromises);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Failed to enqueue skill metric:', expect.any(Error));
  });

  it('does not fail the whole batch when non-critical side effects fail after DB writes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const batch = vi.fn(async () => undefined);

    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('FROM skills')) {
            return {
              bind: () => ({
                all: async () => ({
                  results: [{
                    id: 'skill-1',
                    visibility: 'public',
                    tier: 'archived',
                    next_update_at: null,
                    last_accessed_at: null,
                  }],
                }),
              }),
            };
          }

          return {
            bind: (...args: unknown[]) => ({ sql, args }),
          };
        },
        batch,
      },
      KV: {
        put: vi.fn(async () => {
          throw new Error('kv unavailable');
        }),
      },
    } as never;

    await expect(processQueuedSkillMetrics({
      messages: [{
        body: {
          type: 'skill_metric',
          metric: 'access',
          skillId: 'skill-1',
          occurredAt: Date.parse('2026-04-07T01:00:00.000Z'),
          dedupeKey: 'skill-1:user-1',
        },
      }],
    } as never, env)).resolves.toBeUndefined();

    expect(batch).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Non-critical metrics side effect failed:',
      expect.any(Error)
    );
  });
});
