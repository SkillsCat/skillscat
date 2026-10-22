import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAuth: vi.fn(),
  getCurrentSkillVisibility: vi.fn(),
  peekCachedResponse: vi.fn(),
  putCachedResponse: vi.fn(),
  refreshCachedResponse: vi.fn(),
  resolveTokenBackedIdentity: vi.fn(),
  runRequestSecurity: vi.fn(),
}));

vi.mock('$app/environment', () => ({ building: false, version: 'test-build' }));

vi.mock('$lib/server/auth', () => ({
  createAuth: mocks.createAuth,
  linkAuthorToUser: vi.fn(),
}));

vi.mock('better-auth/svelte-kit', () => ({
  svelteKitHandler: vi.fn(async ({ event, resolve }) => resolve(event)),
}));

vi.mock('$lib/server/cache', () => ({
  getCachedText: vi.fn(),
  peekCachedText: vi.fn(),
  putCachedText: vi.fn(),
  peekCachedResponse: mocks.peekCachedResponse,
  putCachedResponse: mocks.putCachedResponse,
  refreshCachedResponse: mocks.refreshCachedResponse,
  setCacheVersion: vi.fn(),
}));

vi.mock('$lib/server/security/request', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/server/security/request')>(),
  getXRobotsTagForPath: vi.fn(() => null),
  runRequestSecurity: mocks.runRequestSecurity,
}));

vi.mock('$lib/server/skill/visibility', () => ({
  getCurrentSkillVisibility: mocks.getCurrentSkillVisibility,
}));

vi.mock('$lib/server/auth/request-user', () => ({
  resolveTokenBackedIdentity: mocks.resolveTokenBackedIdentity,
}));

function discoveryEvent(input: {
  pathname: string;
  routeId: string;
  cookieLocale?: string;
  cookie?: string;
  waitUntil: (promise: Promise<unknown>) => void;
  params?: Record<string, string>;
}) {
  const url = new URL(`https://skills.cat${input.pathname}`);
  return {
    url,
    request: new Request(url, {
      headers: input.cookie ? { cookie: input.cookie } : undefined,
    }),
    route: { id: input.routeId },
    params: input.params ?? {},
    platform: {
      env: { DB: {} },
      context: { waitUntil: input.waitUntil },
    },
    locals: {},
    cookies: {
      get: vi.fn((name: string) => (name === 'sc_locale' ? input.cookieLocale : undefined)),
      set: vi.fn(),
    },
    isDataRequest: false,
  };
}

function htmlResolve(html = '<html>fresh discovery</html>', headers?: Record<string, string>) {
  return vi.fn(async () => new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers,
    },
  }));
}

function createWaitUntil() {
  const pending: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    pending.push(promise);
  });
  return {
    waitUntil,
    drain: () => Promise.all(pending),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAuth.mockReturnValue({
    api: { getSession: vi.fn(async () => null) },
  });
  mocks.getCurrentSkillVisibility.mockResolvedValue('private');
  mocks.peekCachedResponse.mockResolvedValue(null);
  mocks.putCachedResponse.mockImplementation(async (_key: string, _response: Response, _ttl: number, options: { waitUntil?: (promise: Promise<unknown>) => void }) => {
    options?.waitUntil?.(Promise.resolve());
  });
  mocks.resolveTokenBackedIdentity.mockResolvedValue(null);
  mocks.runRequestSecurity.mockResolvedValue(null);
});

describe('discovery HTML cache', () => {
  it('serves near-expiry HTML immediately and refreshes through the anonymous renderer', async () => {
    const { createPublicHtmlCacheResponse } = await import('$lib/server/cache/public-ssr');
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    mocks.peekCachedResponse.mockResolvedValue(createPublicHtmlCacheResponse(
      new Response('<html>existing</html>', { headers: { 'content-type': 'text/html' } }), 'test-build', 300
    ));
    now.mockReturnValue(370_000);
    try {
      const { handle } = await import('../src/hooks.server');
      const { waitUntil } = createWaitUntil();
      const resolve = htmlResolve('<html>refreshed</html>');
      const response = await handle({ event: discoveryEvent({
        pathname: '/trending', routeId: '/trending', waitUntil,
      }), resolve } as never);
      expect(await response.text()).toContain('existing');
      expect(response.headers.get('X-Cache')).toBe('STALE');
      expect(response.headers.get('Server-Timing')).toContain('ssr_cache');
      expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
      expect(resolve).not.toHaveBeenCalled();
      expect(mocks.refreshCachedResponse).toHaveBeenCalledWith(
        'page:discovery:html:v5:trending:en', expect.any(Function), 300, { waitUntil: expect.any(Function) }
      );
      const render = mocks.refreshCachedResponse.mock.calls[0][1] as () => Promise<Response>;
      const refreshed = await render();
      expect(await refreshed.text()).toBe('<html>refreshed</html>');
      expect(mocks.createAuth).not.toHaveBeenCalled();
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
        locals: expect.objectContaining({ user: null, session: null, authPrincipal: null }),
      }), expect.anything());
    } finally {
      now.mockRestore();
    }
  });

  it('keeps navigation data outside the HTML cache and preserves its existing session resolution', async () => {
    const { handle } = await import('../src/hooks.server');
    const event = discoveryEvent({ pathname: '/recent', routeId: '/recent', waitUntil: () => {} });
    event.isDataRequest = true;
    const resolve = vi.fn(async () => new Response('{"type":"data"}', { headers: { 'content-type': 'application/json' } }));
    const response = await handle({ event, resolve } as never);
    expect(await response.text()).toContain('data');
    expect(mocks.createAuth).toHaveBeenCalledOnce();
    expect(mocks.peekCachedResponse).not.toHaveBeenCalled();
    expect(mocks.putCachedResponse).not.toHaveBeenCalled();
    expect(mocks.refreshCachedResponse).not.toHaveBeenCalled();
  });

  it.each([undefined, 'previous-build'])('rerenders old-build discovery HTML and marks the new cache entry (%s)', async (build) => {
    mocks.peekCachedResponse.mockResolvedValue(new Response('<html>old assets</html>', {
      headers: build ? { 'X-Skillscat-Html-Build': build } : {},
    }));
    const { handle } = await import('../src/hooks.server');
    const resolve = htmlResolve('<html>current assets</html>');
    const response = await handle({ event: discoveryEvent({
      pathname: '/trending', routeId: '/trending', waitUntil: () => {},
    }), resolve } as never);
    expect(await response.text()).toContain('current assets');
    expect(resolve).toHaveBeenCalledOnce();
    const stored = mocks.putCachedResponse.mock.calls[0][1] as Response;
    expect(stored.headers.get('X-Skillscat-Html-Build')).toBe('test-build');
  });

  it('serves cached discovery HTML without running load or auth', async () => {
    mocks.peekCachedResponse.mockImplementation(async (key: string) =>
      key === 'page:discovery:html:v5:trending:en' ? new Response('<html>cached trending</html>', { headers: { 'X-Skillscat-Html-Build': 'test-build' } }) : null
    );
    const { handle } = await import('../src/hooks.server');
    const { waitUntil } = createWaitUntil();
    const resolve = htmlResolve();

    const response = await handle({
      event: discoveryEvent({ pathname: '/trending', routeId: '/trending', waitUntil }),
      resolve,
    } as never);
    const body = await response.text();

    expect(body).toContain('cached trending');
    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(response.headers.get('Content-Language')).toBe('en');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=600'
    );
    expect(response.headers.get('Vary')).toBe('Cookie, Host, Accept');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(mocks.createAuth).not.toHaveBeenCalled();
    expect(mocks.getCurrentSkillVisibility).not.toHaveBeenCalled();
  });

  it('writes discovery HTML to the shared cache through waitUntil on MISS', async () => {
    const { handle } = await import('../src/hooks.server');
    const { waitUntil, drain } = createWaitUntil();
    const resolve = htmlResolve();

    const response = await handle({
      event: discoveryEvent({ pathname: '/trending', routeId: '/trending', waitUntil }),
      resolve,
    } as never);
    const body = await response.text();
    await drain();

    expect(body).toContain('fresh discovery');
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=600'
    );
    expect(response.headers.get('Vary')).toBe('Cookie, Host, Accept');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(waitUntil).toHaveBeenCalled();
    expect(mocks.putCachedResponse).toHaveBeenCalledWith(
      'page:discovery:html:v5:trending:en',
      expect.any(Response),
      300,
      expect.objectContaining({ waitUntil: expect.any(Function) })
    );
  });

  it('uses the short home TTL and home cache key for the homepage', async () => {
    const { handle } = await import('../src/hooks.server');
    const { waitUntil, drain } = createWaitUntil();
    const resolve = htmlResolve('<html>fresh home</html>');

    const response = await handle({
      event: discoveryEvent({ pathname: '/', routeId: '/', waitUntil }),
      resolve,
    } as never);
    await response.text();
    await drain();

    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(response.headers.get('Link')).toContain(
      '</.well-known/api-catalog>; rel="api-catalog"'
    );
    expect(response.headers.get('Link')).toContain('rel="service-desc"');
    expect(response.headers.get('Link')).toContain('rel="service-doc"');
    expect(response.headers.get('Link')).toContain('rel="describedby"');
    expect(mocks.putCachedResponse).toHaveBeenCalledWith(
      'page:home:html:v5:en',
      expect.any(Response),
      60,
      expect.objectContaining({ waitUntil: expect.any(Function) })
    );
    expect(await mocks.putCachedResponse.mock.calls[0][1].text()).toBe('<html>fresh home</html>');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'public, max-age=60, stale-while-revalidate=300'
    );
  });

  it('isolates cached HTML per locale', async () => {
    mocks.peekCachedResponse.mockImplementation(async (key: string) =>
      key === 'page:discovery:html:v5:trending:zh-CN' ? new Response('<html>缓存的发现页</html>', { headers: { 'X-Skillscat-Html-Build': 'test-build' } }) : null
    );
    const { handle } = await import('../src/hooks.server');
    const { waitUntil } = createWaitUntil();
    const resolve = htmlResolve();

    const response = await handle({
      event: discoveryEvent({
        pathname: '/zh-CN/trending',
        routeId: '/trending',
        cookieLocale: 'zh-CN',
        waitUntil,
      }),
      resolve,
    } as never);
    const body = await response.text();

    expect(body).toContain('缓存的发现页');
    expect(response.headers.get('Content-Language')).toBe('zh-CN');
    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(mocks.peekCachedResponse).toHaveBeenCalledWith(
      'page:discovery:html:v5:trending:zh-CN',
      expect.anything()
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('never writes responses with set-cookie to the shared cache', async () => {
    const { handle } = await import('../src/hooks.server');
    const { waitUntil, drain } = createWaitUntil();
    const resolve = htmlResolve('<html>personalized</html>', { 'set-cookie': 'session=abc' });

    const response = await handle({
      event: discoveryEvent({ pathname: '/recent', routeId: '/recent', waitUntil }),
      resolve,
    } as never);
    await response.text();
    await drain();

    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(mocks.putCachedResponse).not.toHaveBeenCalledWith(
      expect.stringContaining('page:discovery:html'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('never writes status-override error pages to the shared cache', async () => {
    const { handle } = await import('../src/hooks.server');
    const { waitUntil, drain } = createWaitUntil();
    const resolve = htmlResolve('<html>not found</html>', { 'X-Skillscat-Status-Override': '404' });

    const response = await handle({
      event: discoveryEvent({
        pathname: '/category/nope',
        routeId: '/category/[slug]',
        params: { slug: 'nope' },
        waitUntil,
      }),
      resolve,
    } as never);
    await response.text();
    await drain();

    expect(response.status).toBe(404);
    expect(response.headers.get('X-Skillscat-Status-Override')).toBeNull();
    expect(mocks.putCachedResponse).not.toHaveBeenCalledWith(
      expect.stringContaining('page:category:html'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('does not make cookie-bearing public SSR cacheable at the CDN', async () => {
    const { handle } = await import('../src/hooks.server');
    const { waitUntil, drain } = createWaitUntil();
    const resolve = htmlResolve();

    const response = await handle({
      event: discoveryEvent({
        pathname: '/trending',
        routeId: '/trending',
        cookie: 'sc_locale=zh-CN',
        waitUntil,
      }),
      resolve,
    } as never);
    await response.text();
    await drain();

    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vary')).toBe('Cookie, Host, Accept');
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('bypasses the shared cache for paginated discovery pages', async () => {
    const { handle } = await import('../src/hooks.server');
    const { waitUntil, drain } = createWaitUntil();
    const resolve = htmlResolve();

    const response = await handle({
      event: discoveryEvent({ pathname: '/trending?page=2', routeId: '/trending', waitUntil }),
      resolve,
    } as never);
    await response.text();
    await drain();

    expect(response.headers.get('X-Cache')).toBeNull();
    expect(mocks.peekCachedResponse).not.toHaveBeenCalledWith(
      expect.stringContaining('page:discovery:html'),
      expect.anything()
    );
    expect(mocks.putCachedResponse).not.toHaveBeenCalledWith(
      expect.stringContaining('page:discovery:html'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    // Paginated pages do not skip auth.
    expect(mocks.createAuth).toHaveBeenCalledOnce();
  });
});
