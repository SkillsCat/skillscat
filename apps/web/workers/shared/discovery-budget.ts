import type { IndexingMessage } from './types/messages';

export interface DiscoveryChannelState { emptyRuns: number; nextRunAt: number; lastCompleted: number; lastIndexed: number; lastRun?: { scanned?: number; queued: number; skippedReason?: string } }
export function nextDiscoveryChannelState(
  previous: DiscoveryChannelState | undefined, input: { completed: number; indexed: number; queued: number; failed: boolean },
  intervalMs: number, now: number
): DiscoveryChannelState {
  const completed = input.completed - (previous?.lastCompleted ?? 0);
  const indexed = input.indexed - (previous?.lastIndexed ?? 0);
  const emptyRuns = indexed > 0 ? 0
    : input.failed || completed > 0 || input.queued === 0 ? (previous?.emptyRuns ?? 0) + 1 : previous?.emptyRuns ?? 0;
  const delay = Math.min(86400000, intervalMs * 2 ** Math.min(10, Math.max(0, emptyRuns - 2)));
  return { emptyRuns, nextRunAt: now + delay, lastCompleted: input.completed, lastIndexed: input.indexed };
}

export async function recordDiscoveryStats(db: D1Database, source: string, values: { queued?: number; completed?: number; indexed?: number; failed?: number }, now = Date.now()) {
  await db.prepare(`
    INSERT INTO discovery_daily_stats (day, source, queued, completed, indexed, failed)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, source) DO UPDATE SET queued = queued + excluded.queued,
      completed = completed + excluded.completed, indexed = indexed + excluded.indexed, failed = failed + excluded.failed
  `).bind(new Date(now).toISOString().slice(0, 10), source, values.queued ?? 0,
    values.completed ?? 0, values.indexed ?? 0, values.failed ?? 0).run();
}

export class DiscoveryBudgetExhausted extends Error {}
export function withDiscoveryQueueBudget<T extends { INDEXING_QUEUE: Queue<IndexingMessage> }>(
  env: T, limit: number, counts: Map<string, number>
): T {
  let queued = 0;
  return { ...env, INDEXING_QUEUE: {
    send: async (message: IndexingMessage, options?: QueueSendOptions) => {
      if (queued >= limit) throw new DiscoveryBudgetExhausted('Discovery queue budget exhausted');
      await env.INDEXING_QUEUE.send(message, options);
      queued++;
      const source = message.discoverySource ?? 'github-events';
      counts.set(source, (counts.get(source) ?? 0) + 1);
    },
    sendBatch: async () => { throw new Error('Discovery requires individually budgeted sends'); },
  } };
}

// Reserve a shared daily queue allowance atomically across cron and consumers.
// The internal row is excluded from channel yield reporting.
export async function reserveDiscoveryAllowance(db: D1Database, requested: number, max: number, now = Date.now()): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  const result = await db.prepare(`
    INSERT INTO discovery_daily_stats (day, source, queued, completed)
    VALUES (?, '__budget__', MIN(?, ?), MIN(?, ?))
    ON CONFLICT(day, source) DO UPDATE SET
      completed = MAX(0, MIN(?, ? - discovery_daily_stats.queued)),
      queued = discovery_daily_stats.queued + MAX(0, MIN(?, ? - discovery_daily_stats.queued))
    RETURNING completed AS allowance
  `).bind(day, requested, max, requested, max, requested, max, requested, max).first<{ allowance: number }>();
  return result?.allowance ?? 0;
}
export async function releaseDiscoveryAllowance(db: D1Database, unused: number, now = Date.now()): Promise<void> {
  if (unused <= 0) return;
  await db.prepare(`UPDATE discovery_daily_stats SET queued = MAX(0, queued - ?)
    WHERE day = ? AND source = '__budget__'`).bind(unused, new Date(now).toISOString().slice(0, 10)).run();
}
