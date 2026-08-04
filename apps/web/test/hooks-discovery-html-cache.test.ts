import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAuth: vi.fn(),
  getCurrentSkillVisibility: vi.fn(),
  peekCachedText: vi.fn(),
  putCachedText: vi.fn(),
  resolveTokenBackedIdentity: vi.fn(),
  runRequestSecurity: vi.fn(),
}));

vi.mock('$app/environment', () => ({ building: false }));

vi.mock('$lib/server/auth', () => ({
  createAuth: mocks.createAuth,
  linkAuthorToUser: vi.fn(),
}));

vi.mock('better-auth/svelte-kit', () => ({
  svelteKitHandler: vi.fn(async ({ event, resolve }) => resolve(event)),
}));

vi.mock('$lib/server/cache', () => ({
  getCachedText: vi.fn(),
  peekCachedText: mocks.peekCachedText,
  putCachedText: mocks.putCachedText,
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
  waitUntil: (promise: Promise<unknown>) => void;
  params?: Record<string, string>;
}) {
  const url = new URL(`https://skills.cat${input.pathname}`);
  return {
    url,
    request: new Request(url),
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
  mocks.peekCachedText.mockResolvedValue(null);
  mocks.putCachedText.mockResolvedValue(undefined);
  mocks.resolveTokenBackedIdentity.mockResolvedValue(null);
  mocks.runRequestSecurity.mockResolvedValue(null);
});

describe('discovery HTML cache', () => {
  it('serves cached discovery HTML without running load or auth', async () => {
    mocks.peekCachedText.mockImplementation(async (key: string) =>
      key === 'page:discovery:html:v1:trending:en' ? '<html>cached trending</html>' : null
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
    expect(waitUntil).toHaveBeenCalled();
    expect(mocks.putCachedText).toHaveBeenCalledWith(
      'page:discovery:html:v1:trending:en',
      '<html>fresh discovery</html>',
      300,
      expect.objectContaining({ contentType: 'text/html; charset=utf-8' })
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
    expect(mocks.putCachedText).toHaveBeenCalledWith(
      'page:home:html:v1:en',
      '<html>fresh home</html>',
      60,
      expect.objectContaining({ contentType: 'text/html; charset=utf-8' })
    );
  });

  it('isolates cached HTML per locale', async () => {
    mocks.peekCachedText.mockImplementation(async (key: string) =>
      key === 'page:discovery:html:v1:trending:zh-CN' ? '<html>缓存的发现页</html>' : null
    );
    const { handle } = await import('../src/hooks.server');
    const { waitUntil } = createWaitUntil();
    const resolve = htmlResolve();

    const response = await handle({
      event: discoveryEvent({
        pathname: '/trending',
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
    expect(mocks.peekCachedText).toHaveBeenCalledWith(
      'page:discovery:html:v1:trending:zh-CN',
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
    expect(mocks.putCachedText).not.toHaveBeenCalledWith(
      expect.stringContaining('page:discovery:html'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
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
    expect(mocks.peekCachedText).not.toHaveBeenCalledWith(
      expect.stringContaining('page:discovery:html'),
      expect.anything()
    );
    expect(mocks.putCachedText).not.toHaveBeenCalledWith(
      expect.stringContaining('page:discovery:html'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    // Paginated pages do not skip auth.
    expect(mocks.createAuth).toHaveBeenCalledOnce();
  });
});
