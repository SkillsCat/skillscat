import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheFirst, networkFirst, staleWhileRevalidate, cleanupOldCaches, isExplicitlyPublicResponse } from '../src/service-worker/cache-strategies';
vi.mock('../src/service-worker/cache-config', () => ({
  CACHE_NAMES: { immutable: 'skillscat-immutable-v1', static: 'skillscat-static-new', api: 'skillscat-api-new' },
  IMMUTABLE_CACHE_MAX_ENTRIES: 2,
  STATIC_PATTERNS: [], API_CACHE_CONFIGS: [], PAGE_DATA_CACHE_CONFIGS: [], PUBLIC_ASSET_CACHE_CONFIGS: [], NO_CACHE_PATTERNS: [],
}));
afterEach(() => { vi.unstubAllGlobals(); });
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function setup(put: () => Promise<void>) {
  const cache = { match: vi.fn(async () => undefined), put: vi.fn(put), delete: vi.fn(async () => true), keys: vi.fn(async () => []) };
  const open = vi.fn(async () => cache);
  vi.stubGlobal('caches', { open });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('network', { headers: { 'Cache-Control': 'public, max-age=60' } })));
  return { cache, open };
}
const request = new Request('https://skills.cat/_app/immutable/entry/app.hash.js');

describe('SW performance without relaxing cache eligibility', () => {
  it.each(['network', 'api', 'static'])('returns %s response before a stalled cache write completes', async (strategy) => {
    const pending = gate(); setup(() => pending.promise);
    const tasks: Promise<unknown>[] = [];
    const options = { waitUntil: (task: Promise<unknown>) => { tasks.push(task); } };
    const response = await (strategy === 'network'
      ? networkFirst(request, 'pages', isExplicitlyPublicResponse, options)
      : strategy === 'api'
        ? staleWhileRevalidate(request, { pattern: /.*/, maxAge: 1000, staleWhileRevalidate: 1000 }, options)
        : cacheFirst(request, options));
    expect(await response.text()).toBe('network');
    expect(tasks).toHaveLength(1);
    pending.release(); await Promise.all(tasks);
  });
  it('preserves successful network responses when storage fails', async () => {
    setup(async () => { throw new Error('quota'); });
    const tasks: Promise<unknown>[] = [];
    const response = await networkFirst(request, 'pages', isExplicitlyPublicResponse, { waitUntil: (task) => { tasks.push(task); } });
    expect(await response.text()).toBe('network');
    await expect(Promise.all(tasks)).resolves.toBeDefined();
  });
  it('evicts non-public entries before returning and never writes them', async () => {
    const { cache } = setup(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private', { headers: { 'Cache-Control': 'no-store' } })));
    await networkFirst(request, 'pages', isExplicitlyPublicResponse);
    expect(cache.delete).toHaveBeenCalledOnce(); expect(cache.put).not.toHaveBeenCalled();
  });
  it('reuses immutable assets across deployments and keeps mutable assets versioned', async () => {
    const { cache, open } = setup(async () => {});
    vi.mocked(cache.match).mockResolvedValue(new Response('cached') as never);
    expect(await (await cacheFirst(request, { immutable: true })).text()).toBe('cached');
    expect(open).toHaveBeenLastCalledWith('skillscat-immutable-v1');
    await cacheFirst(request);
    expect(open).toHaveBeenLastCalledWith('skillscat-static-new');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds the immutable cache and cleans only owned obsolete caches', async () => {
    const { cache } = setup(async () => {});
    const old = new Request('https://skills.cat/_app/immutable/old.hash.js');
    vi.mocked(cache.keys).mockResolvedValue([old, request, new Request('https://skills.cat/_app/immutable/new.hash.js')] as never);
    const tasks: Promise<unknown>[] = [];
    await cacheFirst(request, { immutable: true, waitUntil: (task) => { tasks.push(task); } });
    await Promise.all(tasks); expect(cache.delete).toHaveBeenCalledWith(old);
    const remove = vi.fn(async () => true);
    vi.stubGlobal('caches', { keys: async () => ['skillscat-immutable-v1', 'skillscat-static-old', 'another-app'], delete: remove });
    await cleanupOldCaches();
    expect(remove.mock.calls).toEqual([['skillscat-static-old']]);
  });
});
