import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillscatStateDurableObject } from '../src/lib/server/state/durable-object';

class MemoryStorage {
  private readonly store = new Map<string, unknown>();
  readonly getCalls: Array<string | string[]> = [];
  readonly putCalls: Array<Record<string, unknown>> = [];

  async get(keyOrKeys: string | string[]): Promise<unknown> {
    this.getCalls.push(keyOrKeys);

    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, unknown>();
      for (const key of keyOrKeys) {
        const value = this.store.get(key);
        if (value !== undefined) {
          result.set(key, value);
        }
      }
      return result;
    }

    return this.store.get(keyOrKeys);
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.putCalls.push({ [keyOrEntries]: value });
      this.store.set(keyOrEntries, value);
      return;
    }

    this.putCalls.push(keyOrEntries);
    for (const [key, entryValue] of Object.entries(keyOrEntries)) {
      this.store.set(key, entryValue);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async transaction<T>(closure: (transaction: MemoryStorage) => Promise<T>): Promise<T> {
    return await closure(this);
  }
}

function createHarness() {
  const storage = new MemoryStorage();
  const durableObject = new SkillscatStateDurableObject({ storage } as never);

  const call = async (operation: string, body: unknown): Promise<{ status: number; json: unknown }> => {
    const response = await durableObject.fetch(new Request(`https://state.internal/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));

    return { status: response.status, json: await response.json() };
  };

  return { storage, call };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SkillscatStateDurableObject rate-limit/check', () => {
  it('batches penalty and counter reads into one storage call', async () => {
    const { storage, call } = createHarness();

    const { json } = await call('rate-limit/check', {
      key: 'test:ip',
      config: { limit: 5, windowSeconds: 60 },
    });

    expect(json).toEqual(expect.objectContaining({ allowed: true, remaining: 4 }));

    const batchReads = storage.getCalls.filter((entry) => Array.isArray(entry));
    expect(batchReads.length).toBe(1);
    expect(batchReads[0]).toEqual([
      'rate-limit:test:ip:penalty',
      'rate-limit:test:ip:counter',
    ]);
  });

  it('escalates penalty with a single batched write after repeated violations', async () => {
    const { storage, call } = createHarness();
    const body = {
      key: 'test:abuser',
      config: { limit: 1, windowSeconds: 60 },
    };

    const first = await call('rate-limit/check', body);
    expect(first.json).toEqual(expect.objectContaining({ allowed: true }));

    const second = await call('rate-limit/check', body);
    expect(second.json).toEqual(expect.objectContaining({ allowed: false, penaltyLevel: 0 }));

    await call('rate-limit/check', body);
    const fourth = await call('rate-limit/check', body);
    expect(fourth.json).toEqual(expect.objectContaining({ allowed: false, penaltyLevel: 0 }));

    const fifth = await call('rate-limit/check', body);
    // 惩罚生效:窗口从 60s 加倍到 120s,计数器按新 penaltyLevel 重新计数。
    expect(fifth.json).toEqual(expect.objectContaining({
      allowed: true,
      penaltyLevel: 1,
      windowSeconds: 120,
    }));

    const batchedWrite = storage.putCalls.find((entry) =>
      Object.keys(entry).some((key) => key.endsWith(':violations'))
      && Object.keys(entry).some((key) => key.endsWith(':penalty'))
    );
    expect(batchedWrite).toBeDefined();
    expect(batchedWrite?.['rate-limit:test:abuser:penalty']).toEqual(expect.objectContaining({
      value: 1,
    }));
  });
});

describe('SkillscatStateDurableObject kv/getMany', () => {
  it('returns values in request order and nulls for missing keys', async () => {
    const { call } = createHarness();

    await call('kv/put', { key: 'a', value: '1' });
    await call('kv/put', { key: 'b', value: '2' });

    const { json } = await call('kv/getMany', { keys: ['a', 'missing', 'b'] });
    expect(json).toEqual({ values: ['1', null, '2'] });
  });

  it('returns null for expired values', async () => {
    const { call } = createHarness();

    await call('kv/put', { key: 'a', value: '1', expirationTtl: 30 });

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));

    const { json } = await call('kv/getMany', { keys: ['a'] });
    expect(json).toEqual({ values: [null] });
  });

  it('rejects empty key lists', async () => {
    const { call } = createHarness();

    const { status } = await call('kv/getMany', { keys: [] });
    expect(status).toBe(400);
  });
});

describe('SkillscatStateDurableObject kv/putIfChanged', () => {
  const snapshot = (remaining: number, updatedAtEpochMs: number) => JSON.stringify({
    bucket: 'rest',
    limit: 5000,
    remaining,
    used: 5000 - remaining,
    resetAtEpochSec: 1800000000,
    updatedAtEpochMs,
    source: 'headers',
  });

  it('writes when no existing value is stored', async () => {
    const { call } = createHarness();
    const now = Date.now();

    const { json } = await call('kv/putIfChanged', {
      key: 'snap',
      value: snapshot(4200, now),
      ignoreFields: ['updatedAtEpochMs'],
      noopWithinMs: 60_000,
      updatedAtField: 'updatedAtEpochMs',
    });

    expect(json).toEqual(expect.objectContaining({ written: true }));
  });

  it('skips writing an equivalent snapshot inside the noop window', async () => {
    const { call } = createHarness();
    const now = Date.now();

    await call('kv/putIfChanged', {
      key: 'snap',
      value: snapshot(4200, now - 5_000),
      ignoreFields: ['updatedAtEpochMs'],
      noopWithinMs: 60_000,
      updatedAtField: 'updatedAtEpochMs',
    });

    const { json } = await call('kv/putIfChanged', {
      key: 'snap',
      value: snapshot(4200, now),
      ignoreFields: ['updatedAtEpochMs'],
      noopWithinMs: 60_000,
      updatedAtField: 'updatedAtEpochMs',
    });

    expect(json).toEqual(expect.objectContaining({ written: false }));

    const stored = await call('kv/get', { key: 'snap' });
    expect(stored.json).toEqual({ value: snapshot(4200, now - 5_000) });
  });

  it('writes when snapshot fields differ', async () => {
    const { call } = createHarness();
    const now = Date.now();

    await call('kv/putIfChanged', {
      key: 'snap',
      value: snapshot(4200, now),
      ignoreFields: ['updatedAtEpochMs'],
      noopWithinMs: 60_000,
      updatedAtField: 'updatedAtEpochMs',
    });

    const { json } = await call('kv/putIfChanged', {
      key: 'snap',
      value: snapshot(3000, now),
      ignoreFields: ['updatedAtEpochMs'],
      noopWithinMs: 60_000,
      updatedAtField: 'updatedAtEpochMs',
    });

    expect(json).toEqual(expect.objectContaining({ written: true }));
  });

  it('writes an equivalent snapshot once the noop window has passed', async () => {
    const { call } = createHarness();
    const now = Date.now();

    await call('kv/putIfChanged', {
      key: 'snap',
      value: snapshot(4200, now - 120_000),
      ignoreFields: ['updatedAtEpochMs'],
      noopWithinMs: 60_000,
      updatedAtField: 'updatedAtEpochMs',
    });

    const { json } = await call('kv/putIfChanged', {
      key: 'snap',
      value: snapshot(4200, now),
      ignoreFields: ['updatedAtEpochMs'],
      noopWithinMs: 60_000,
      updatedAtField: 'updatedAtEpochMs',
    });

    expect(json).toEqual(expect.objectContaining({ written: true }));
  });
});

describe('SkillscatStateDurableObject github-rate-limit/reserve', () => {
  function snapshot(remaining: number, updatedAtEpochMs: number): string {
    return JSON.stringify({
      bucket: 'rest',
      limit: 5000,
      remaining,
      used: 5000 - remaining,
      resetAtEpochSec: Math.floor(updatedAtEpochMs / 1000) + 3600,
      updatedAtEpochMs,
      source: 'rate_limit_api',
    });
  }

  it('atomically accounts for prior batch reservations without rewriting token snapshots', async () => {
    const { call } = createHarness();
    const now = Date.now();
    const keys = [
      'github-rate-limit:token:a:rest',
      'github-rate-limit:token:b:rest',
    ];

    await call('kv/put', { key: keys[0], value: snapshot(700, now), expirationTtl: 7200 });
    await call('kv/put', { key: keys[1], value: snapshot(600, now), expirationTtl: 7200 });

    const first = await call('github-rate-limit/reserve', {
      keys,
      reservationKey: 'github-rate-limit:rest:a,b',
      bucket: 'rest',
      requestCost: 300,
      reservePerToken: 500,
      maxAgeMs: 600_000,
    });
    expect(first.json).toEqual(expect.objectContaining({
      allowed: true,
      status: 'allowed',
      remaining: 1000,
      required: 1300,
    }));

    const second = await call('github-rate-limit/reserve', {
      keys,
      reservationKey: 'github-rate-limit:rest:a,b',
      bucket: 'rest',
      requestCost: 1,
      reservePerToken: 500,
      maxAgeMs: 600_000,
    });
    expect(second.json).toEqual(expect.objectContaining({
      allowed: false,
      status: 'insufficient',
      remaining: 1000,
      required: 1001,
    }));

    await expect(call('kv/get', { key: keys[0] })).resolves.toEqual(expect.objectContaining({
      json: { value: snapshot(700, now) },
    }));
    await expect(call('kv/get', { key: keys[1] })).resolves.toEqual(expect.objectContaining({
      json: { value: snapshot(600, now) },
    }));
  });

  it('discards old reservations after refreshed snapshots change the fingerprint', async () => {
    const { call } = createHarness();
    const now = Date.now();
    const key = 'github-rate-limit:token:a:rest';
    const body = {
      keys: [key],
      reservationKey: 'github-rate-limit:rest:a',
      bucket: 'rest',
      requestCost: 100,
      reservePerToken: 500,
      maxAgeMs: 600_000,
    };

    await call('kv/put', { key, value: snapshot(600, now), expirationTtl: 7200 });
    expect((await call('github-rate-limit/reserve', body)).json).toEqual(
      expect.objectContaining({ allowed: true })
    );
    expect((await call('github-rate-limit/reserve', { ...body, requestCost: 1 })).json).toEqual(
      expect.objectContaining({ allowed: false, status: 'insufficient' })
    );

    await call('kv/put', { key, value: snapshot(600, now + 1), expirationTtl: 7200 });
    expect((await call('github-rate-limit/reserve', { ...body, requestCost: 1 })).json).toEqual(
      expect.objectContaining({ allowed: true, status: 'allowed' })
    );
  });
});
