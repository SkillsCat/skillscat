import { afterEach, describe, expect, it, vi } from 'vitest';
import { peekCachedResponse, putCachedResponse, setCacheVersion } from '../src/lib/server/cache';

afterEach(() => { vi.unstubAllGlobals(); setCacheVersion(undefined); });

describe('streaming response cache', () => {
  it('returns a hit without reading its body', async () => {
    const cached = new Response('<html>缓存</html>');
    const text = vi.spyOn(cached, 'text');
    const match = vi.fn(async (_request: Request) => cached);
    vi.stubGlobal('caches', { default: { match } });
    setCacheVersion('cpu-test');
    const response = await peekCachedResponse('page:test');
    expect(response).toBe(cached);
    expect(response?.bodyUsed).toBe(false);
    expect(text).not.toHaveBeenCalled();
    expect(match.mock.calls[0][0].url).toBe('https://skills.cat/cache/v/cpu-test/page:test');
  });

  it('promotes legacy streams, and can disable legacy fallback', async () => {
    const match = vi.fn(async (request: Request) => request.url.includes('/v/') ? undefined : new Response('legacy'));
    const put = vi.fn(async (_request: Request, response: Response) => { expect(await response.text()).toBe('legacy'); });
    const pending: Promise<unknown>[] = [];
    vi.stubGlobal('caches', { default: { match, put } });
    const response = await peekCachedResponse('page:test', { waitUntil: (promise) => pending.push(promise) });
    expect(await response?.text()).toBe('legacy');
    await Promise.all(pending);
    expect(put).toHaveBeenCalledOnce();
    match.mockClear();
    expect(await peekCachedResponse('page:test', { allowLegacyFallback: false })).toBeNull();
    expect(match).toHaveBeenCalledOnce();
  });

  it('writes a stream through waitUntil without consuming it in JavaScript', async () => {
    const response = new Response('<html>缓存</html>', { headers: { 'Content-Type': 'text/html' } });
    const text = vi.spyOn(response, 'text');
    const put = vi.fn(async (_request: Request, _response: Response) => {});
    const waitUntil = vi.fn();
    vi.stubGlobal('caches', { default: { put } });
    await putCachedResponse('page:test', response, 60, { waitUntil });
    expect(text).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledOnce();
    const stored = put.mock.calls[0][1];
    expect(stored.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(stored.headers.get('Content-Type')).toBe('text/html');
    expect(await stored.text()).toBe('<html>缓存</html>');
  });

  it('excludes cookie and error responses, and tolerates Cache API failures', async () => {
    const put = vi.fn(async () => { throw new Error('cache unavailable'); });
    vi.stubGlobal('caches', { default: { put, match: vi.fn(async () => { throw new Error('cache unavailable'); }) } });
    await putCachedResponse('private', new Response('private', { headers: { 'set-cookie': 'session=test' } }), 60);
    await putCachedResponse('error', new Response('error', { status: 500 }), 60);
    expect(put).not.toHaveBeenCalled();
    const pending: Promise<unknown>[] = [];
    await putCachedResponse('public', new Response('ok'), 60, { waitUntil: (promise) => pending.push(promise) });
    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect(await peekCachedResponse('public')).toBeNull();
  });
});
