import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRetryAfterMs, tryClaimVirusTotalWork, tryConsumeBudget } from '../workers/virustotal';

function createKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('virustotal worker helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T10:20:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('consumes minute and daily VT budget under the configured limits', async () => {
    const kv = createKv();
    const allowed = await tryConsumeBudget({
      DB: {} as never,
      KV: kv as never,
      R2: {} as never,
      VT_DAILY_REQUEST_BUDGET: '300',
      VT_MINUTE_REQUEST_BUDGET: '4',
    } as never);

    expect(allowed).toBe(true);
    expect(kv.put).toHaveBeenCalledTimes(2);
    expect(kv.store.get('vt:budget:day:2026-03-17')).toBe('1');
    expect(kv.store.get('vt:budget:minute:2026-03-17T10:20')).toBe('1');
  });

  it('refuses VT work when the minute budget is exhausted', async () => {
    const kv = createKv({
      'vt:budget:day:2026-03-17': '10',
      'vt:budget:minute:2026-03-17T10:20': '4',
    });

    const allowed = await tryConsumeBudget({
      DB: {} as never,
      KV: kv as never,
      R2: {} as never,
      VT_DAILY_REQUEST_BUDGET: '300',
      VT_MINUTE_REQUEST_BUDGET: '4',
    } as never);

    expect(allowed).toBe(false);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('parses Retry-After seconds and date values for VT backoff', () => {
    expect(parseRetryAfterMs(new Response(null, {
      headers: { 'retry-after': '120' },
    }))).toBe(120_000);

    const dateHeader = new Date(Date.now() + 60_000).toUTCString();
    const parsed = parseRetryAfterMs(new Response(null, {
      headers: { 'retry-after': dateHeader },
    }));

    expect(parsed).toBeGreaterThanOrEqual(15_000);
    expect(parsed).toBeLessThanOrEqual(60_000);
  });

  it('claims VT work only when the row is due and unchanged', async () => {
    const runs: unknown[][] = [];
    const db = {
      prepare: (sql: string) => {
        expect(sql).toContain('UPDATE skill_security_state');
        expect(sql).toContain('vt_status = ?');
        expect(sql).toContain('vt_next_attempt_at IS NULL OR vt_next_attempt_at <= ?');
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

    expect(await tryClaimVirusTotalWork(db as never, {
      skillId: 'skill-1',
      status: 'pending_lookup',
      now: 2_000,
      leaseMs: 4_000,
    })).toBe(true);

    expect(await tryClaimVirusTotalWork(db as never, {
      skillId: 'skill-1',
      status: 'pending_lookup',
      now: 2_100,
      leaseMs: 4_000,
    })).toBe(false);

    expect(runs[0]).toEqual([6_000, 2_000, 'skill-1', 'pending_lookup', 2_000]);
  });
});
