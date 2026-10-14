import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCached, invalidateCache, setCacheVersion } from '../src/lib/server/cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let store: Map<string, Response>;
let tasks: Promise<unknown>[];
const waitUntil = (task: Promise<unknown>) => { tasks.push(task); };
async function drain() { for (let i = 0; i < tasks.length; i++) await tasks[i]; }
beforeEach(() => {
  store = new Map(); tasks = [];
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  setCacheVersion('swr-test');
  vi.stubGlobal('caches', { default: {
    match: vi.fn(async (request: Request) => store.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => { store.set(request.url, response); }),
    delete: vi.fn(async (request: Request) => store.delete(request.url)),
  } });
});
afterEach(async () => { await drain(); vi.unstubAllGlobals(); vi.useRealTimers(); setCacheVersion(undefined); });

describe('opt-in Cache API SWR', () => {
  it('serves stale data immediately, coalesces refreshes, and publishes fresh data', async () => {
    const options = { waitUntil, staleWhileRevalidate: 120 };
    await getCached('list', async () => 'old', 30, options); await drain();
    vi.setSystemTime(1_031_000);
    const next = deferred<string>();
    const fetcher = vi.fn(() => next.promise);
    const results = await Promise.all(Array.from({ length: 8 }, () => getCached('list', fetcher, 30, options)));
    expect(results.every((r) => r.data === 'old' && r.hit && r.stale)).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    next.resolve('new'); await drain();
    expect(await getCached('list', fetcher, 30, options)).toEqual({ data: 'new', hit: true });
  });

  it('does not serve stale data after its deadline or without waitUntil', async () => {
    await getCached('deadline', async () => 'old', 30, { waitUntil, staleWhileRevalidate: 120 }); await drain();
    vi.setSystemTime(1_151_000);
    expect(await getCached('deadline', async () => 'new', 30, { waitUntil, staleWhileRevalidate: 120 })).toEqual({ data: 'new', hit: false });
    await drain(); vi.setSystemTime(1_182_000);
    expect(await getCached('deadline', async () => 'blocking', 30, { staleWhileRevalidate: 120 })).toEqual({ data: 'blocking', hit: false });
  });

  it('retains bounded stale data on refresh failure and retries on the next request', async () => {
    const options = { waitUntil, staleWhileRevalidate: 120 };
    await getCached('failure', async () => 'old', 30, options); await drain();
    vi.setSystemTime(1_031_000);
    expect((await getCached('failure', async () => { throw new Error('upstream'); }, 30, options)).data).toBe('old');
    await drain();
    const retry = vi.fn(async () => 'recovered');
    await getCached('failure', retry, 30, options); await drain();
    expect(retry).toHaveBeenCalledOnce();
    expect((await getCached('failure', retry, 30, options)).data).toBe('recovered');
  });

  it('does not republish an invalidated in-flight refresh', async () => {
    const options = { waitUntil, staleWhileRevalidate: 120 };
    await getCached('invalidate', async () => 'old', 30, options); await drain();
    vi.setSystemTime(1_031_000);
    const next = deferred<string>();
    await getCached('invalidate', () => next.promise, 30, options);
    await invalidateCache('invalidate'); next.resolve('obsolete'); await drain();
    expect(store.size).toBe(0);
    expect((await getCached('invalidate', async () => 'current', 30, options)).data).toBe('current');
  });

  it('evicts after an already-started slow write rather than resurrecting the entry', async () => {
    const writing = deferred<void>();
    vi.stubGlobal('caches', { default: {
      match: async () => undefined,
      put: async (request: Request, response: Response) => { await writing.promise; store.set(request.url, response); },
      delete: async (request: Request) => store.delete(request.url),
    } });
    await getCached('write-race', async () => 'old', 30, { waitUntil });
    const invalidation = invalidateCache('write-race');
    writing.resolve();
    await invalidation; await drain();
    expect(store.size).toBe(0);
  });

  it('does not persist a temporary render and does not reuse stale data for non-opted-in callers', async () => {
    await getCached('plain', async () => 'temporary', 30, { waitUntil, shouldCache: () => false }); await drain();
    expect(store.size).toBe(0);
    await getCached('shared', async () => 'old', 30, { waitUntil, staleWhileRevalidate: 120 }); await drain();
    vi.setSystemTime(1_031_000);
    expect(await getCached('shared', async () => 'fresh', 30, { waitUntil })).toEqual({ data: 'fresh', hit: false });
  });
});
