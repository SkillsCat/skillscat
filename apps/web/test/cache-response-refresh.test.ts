import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidateCache, refreshCachedResponse, setCacheVersion } from '$lib/server/cache';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setCacheVersion(undefined); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const pending: Promise<unknown>[] = [];
  const waitUntil = (promise: Promise<unknown>) => { pending.push(promise); };
  const put = vi.fn(async (_request: Request, response: Response) => { await response.text(); });
  const remove = vi.fn(async (_request: Request) => true);
  vi.stubGlobal('caches', { default: { put, delete: remove } });
  return { put, remove, waitUntil, pending };
}

describe('background response refresh', () => {
  it('recovers a lock after the Workers waitUntil deadline without publishing the cancelled result', async () => {
    const { put, waitUntil, pending } = setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const abandoned = deferred<Response>();
    refreshCachedResponse('ssr:deadline', () => abandoned.promise, 60, { waitUntil });
    await Promise.resolve();
    now.mockReturnValue(130_001);
    refreshCachedResponse('ssr:deadline', async () => new Response('new render'), 60, { waitUntil });
    await pending[1];
    abandoned.resolve(new Response('cancelled render'));
    await pending[0];
    expect(put).toHaveBeenCalledOnce();
  });

  it('coalesces same-key renders through the end of cache publication', async () => {
    const { put, waitUntil, pending } = setup();
    const renderResult = deferred<Response>();
    const publication = deferred<void>();
    put.mockImplementationOnce(async () => publication.promise);
    const render = vi.fn(() => renderResult.promise);
    refreshCachedResponse('ssr:coalesce', render, 60, { waitUntil });
    refreshCachedResponse('ssr:coalesce', render, 60, { waitUntil });
    await Promise.resolve();
    expect(render).toHaveBeenCalledOnce();
    renderResult.resolve(new Response('html'));
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    refreshCachedResponse('ssr:coalesce', render, 60, { waitUntil });
    expect(render).toHaveBeenCalledOnce();
    publication.resolve();
    await Promise.all(pending);
    expect(pending).toHaveLength(1);
  });

  it('isolates locales and deployment namespaces and captures the originating namespace', async () => {
    const { put, waitUntil, pending } = setup();
    const result = deferred<Response>();
    setCacheVersion('one');
    refreshCachedResponse('ssr:en', () => result.promise, 60, { waitUntil });
    refreshCachedResponse('ssr:zh-CN', async () => new Response('Chinese'), 60, { waitUntil });
    setCacheVersion('two');
    refreshCachedResponse('ssr:en', async () => new Response('new build'), 60, { waitUntil });
    result.resolve(new Response('English'));
    await Promise.all(pending);
    expect(put.mock.calls.map(([request]) => request.url).sort()).toEqual([
      'https://skills.cat/cache/v/one/ssr:en',
      'https://skills.cat/cache/v/one/ssr:zh-CN',
      'https://skills.cat/cache/v/two/ssr:en',
    ]);
  });

  it('does not resurrect an entry invalidated while it was rendering', async () => {
    const { put, waitUntil, pending } = setup();
    const result = deferred<Response>();
    refreshCachedResponse('ssr:invalidated', () => result.promise, 60, { waitUntil });
    await invalidateCache('ssr:invalidated');
    result.resolve(new Response('old visibility'));
    await Promise.all(pending);
    expect(put).not.toHaveBeenCalled();
  });

  it('deletes after a cache write already in progress has finished', async () => {
    const { put, remove, waitUntil, pending } = setup();
    const publication = deferred<void>();
    put.mockImplementationOnce(async () => publication.promise);
    refreshCachedResponse('ssr:publishing', async () => new Response('html'), 60, { waitUntil });
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    const invalidation = invalidateCache('ssr:publishing');
    await Promise.resolve();
    expect(remove).not.toHaveBeenCalled();
    publication.resolve();
    await invalidation;
    await Promise.all(pending);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('releases failed refreshes for retry and does not publish errors or cookies', async () => {
    const { put, waitUntil, pending } = setup();
    for (const render of [
      async (): Promise<Response> => { throw new Error('render failed'); },
      async () => null,
      async () => new Response('error', { status: 500 }),
      async () => new Response('private', { headers: { 'set-cookie': 'test=private' } }),
    ]) {
      refreshCachedResponse('ssr:retry', render, 60, { waitUntil });
      await Promise.all(pending);
    }
    expect(put).not.toHaveBeenCalled();
    refreshCachedResponse('ssr:retry', async () => new Response('recovered'), 60, { waitUntil });
    await Promise.all(pending);
    expect(put).toHaveBeenCalledOnce();
  });
});
