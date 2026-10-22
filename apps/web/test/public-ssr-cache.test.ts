import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicHtmlCacheResponse, getPublicHtmlCacheStatus } from '$lib/server/cache/public-ssr';

afterEach(() => vi.restoreAllMocks());

describe('public SSR cache policy', () => {
  it.each([60, 300])('refreshes near expiry without extending the original %s second lifetime', (ttl) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const cached = createPublicHtmlCacheResponse(new Response('<html>SSR</html>', {
      headers: { 'content-type': 'text/html' },
    }), 'build-a', ttl)!;
    expect(getPublicHtmlCacheStatus(cached, 'build-a')).toBe('HIT');
    now.mockReturnValue(100_000 + (ttl - Math.min(30, ttl * 0.1)) * 1000);
    expect(getPublicHtmlCacheStatus(cached, 'build-a')).toBe('STALE');
    now.mockReturnValue(100_000 + ttl * 1000);
    expect(getPublicHtmlCacheStatus(cached, 'build-a')).toBe('MISS');
  });

  it('never decodes HTML or shares build-specific asset references across builds', async () => {
    const response = new Response('<html>SSR</html>', { headers: { 'content-type': 'text/html' } });
    const text = vi.spyOn(response, 'text');
    const cached = createPublicHtmlCacheResponse(response, 'build-a', 60)!;
    expect(text).not.toHaveBeenCalled();
    expect(getPublicHtmlCacheStatus(cached, 'build-b')).toBe('MISS');
    expect(await cached.text()).toBe('<html>SSR</html>');
  });

  it.each([
    { 'set-cookie': 'test-session=private' },
    { 'cache-control': 'private, max-age=30' },
    { 'cache-control': 'no-store' },
    { 'X-Skillscat-Status-Override': '404' },
  ])('rejects unsafe response headers %j', (headers) => {
    expect(createPublicHtmlCacheResponse(new Response('unsafe', {
      headers: { 'content-type': 'text/html', ...headers },
    }), 'build-a', 60)).toBeNull();
  });

  it('rejects errors, partial HTML, and navigation data', () => {
    for (const status of [206, 404, 500]) {
      expect(createPublicHtmlCacheResponse(new Response('error', {
        status, headers: { 'content-type': 'text/html' },
      }), 'build-a', 60)).toBeNull();
    }
    expect(createPublicHtmlCacheResponse(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }), 'build-a', 60)).toBeNull();
  });

  it('fails closed on corrupt expiry metadata', () => {
    expect(getPublicHtmlCacheStatus(new Response('html', { headers: {
      'X-Skillscat-Html-Build': 'build-a', 'X-Skillscat-Html-Refresh-After': 'invalid',
      'X-Skillscat-Html-Expires': 'invalid',
    } }), 'build-a')).toBe('MISS');
  });
});
