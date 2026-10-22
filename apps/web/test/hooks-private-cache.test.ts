import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAuth: vi.fn(),
  getCurrentSkillVisibility: vi.fn(),
  peekCachedText: vi.fn(),
  peekCachedResponse: vi.fn(),
  putCachedResponse: vi.fn(),
  refreshCachedResponse: vi.fn(),
  putCachedText: vi.fn(),
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
  peekCachedText: mocks.peekCachedText,
  peekCachedResponse: mocks.peekCachedResponse,
  putCachedResponse: mocks.putCachedResponse,
  refreshCachedResponse: mocks.refreshCachedResponse,
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

function skillEvent() {
  const url = new URL('https://skills.cat/skills/acme/private-skill');
  return {
    url,
    request: new Request(url),
    route: { id: '/skills/[owner]/[...name]' },
    params: { owner: 'acme', name: 'private-skill' },
    platform: {
      env: { DB: {} },
      context: { waitUntil: vi.fn() },
    },
    locals: {},
    cookies: {
      get: vi.fn(() => undefined),
      set: vi.fn(),
    },
    isDataRequest: false,
  };
}

function privateResolve() {
  return vi.fn(async () => new Response('<html>private response</html>', {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-cache',
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAuth.mockReturnValue({
    api: { getSession: vi.fn(async () => null) },
  });
  mocks.getCurrentSkillVisibility.mockResolvedValue('private');
  mocks.peekCachedText.mockResolvedValue(null);
  mocks.peekCachedResponse.mockResolvedValue(null);
  mocks.putCachedResponse.mockResolvedValue(undefined);
  mocks.putCachedText.mockResolvedValue(undefined);
  mocks.resolveTokenBackedIdentity.mockResolvedValue(null);
  mocks.runRequestSecurity.mockResolvedValue(null);
});

describe('skill HTML cache visibility hint', () => {
  it.each([
    { 'Cache-Control': 'private, no-cache' },
    { 'X-Skillscat-Public-Skill-Cache': '1', 'set-cookie': 'test-session=private' },
    { 'X-Skillscat-Public-Skill-Cache': '1', 'X-Skillscat-Status-Override': '404' },
  ])('does not publish unsafe background renders: %j', async (headers) => {
    mocks.peekCachedText.mockResolvedValue('public');
    mocks.peekCachedResponse.mockResolvedValue(new Response('<html>existing public</html>', {
      headers: {
        'X-Skillscat-Html-Build': 'test-build',
        'X-Skillscat-Html-Refresh-After': String(Date.now() - 1000),
        'X-Skillscat-Html-Expires': String(Date.now() + 20_000),
      },
    }));
    const { handle } = await import('../src/hooks.server');
    const resolve = vi.fn(async () => new Response('<html>unsafe refresh</html>', {
      headers: { 'content-type': 'text/html', ...headers },
    }));
    const response = await handle({ event: skillEvent(), resolve } as never);
    expect(await response.text()).toContain('existing public');
    expect(response.headers.get('X-Cache')).toBe('STALE');
    expect(resolve).not.toHaveBeenCalled();
    const refresh = mocks.refreshCachedResponse.mock.calls[0][1] as () => Promise<Response | null>;
    expect(await refresh()).toBeNull();
    expect(mocks.putCachedResponse).not.toHaveBeenCalled();
    expect(mocks.putCachedText).not.toHaveBeenCalled();
    expect(mocks.createAuth).not.toHaveBeenCalled();
  });

  it.each([undefined, 'previous-build'])('does not serve HTML referencing assets from another build (%s)', async (build) => {
    mocks.peekCachedText.mockResolvedValue('public');
    mocks.peekCachedResponse.mockResolvedValue(new Response('<html>old assets</html>', {
      headers: build ? { 'X-Skillscat-Html-Build': build } : {},
    }));
    const { handle } = await import('../src/hooks.server');
    const resolve = vi.fn(async () => new Response('<html>current assets</html>', {
      headers: { 'Content-Type': 'text/html', 'X-Skillscat-Public-Skill-Cache': '1' },
    }));
    const response = await handle({ event: skillEvent(), resolve } as never);
    expect(await response.text()).toContain('current assets');
    expect(resolve).toHaveBeenCalledOnce();
    const stored = mocks.putCachedResponse.mock.calls[0][1] as Response;
    expect(stored.headers.get('X-Skillscat-Html-Build')).toBe('test-build');
  });

  it('serves cached public HTML without touching D1 when the hint says public', async () => {
    mocks.peekCachedText.mockImplementation(async (key: string) => {
      if (key.includes('page:skill:public')) return 'public';
      return null;
    });
    mocks.peekCachedResponse.mockImplementation(async () => new Response('<html>cached public content</html>', { headers: { 'X-Skillscat-Html-Build': 'test-build' } }));
    const { handle } = await import('../src/hooks.server');
    const resolve = privateResolve();

    const response = await handle({ event: skillEvent(), resolve } as never);
    const body = await response.text();

    expect(body).toContain('cached public content');
    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(mocks.getCurrentSkillVisibility).not.toHaveBeenCalled();
    expect(mocks.createAuth).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('treats legacy hint entries as public', async () => {
    mocks.peekCachedText.mockImplementation(async (key: string) => {
      if (key.includes('page:skill:public')) return '1';
      return null;
    });
    mocks.peekCachedResponse.mockImplementation(async () => new Response('<html>cached public content</html>', { headers: { 'X-Skillscat-Html-Build': 'test-build' } }));
    const { handle } = await import('../src/hooks.server');
    const resolve = privateResolve();

    const response = await handle({ event: skillEvent(), resolve } as never);

    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(mocks.getCurrentSkillVisibility).not.toHaveBeenCalled();
  });

  it('does not serve cached public HTML when the cached hint says private, without touching D1', async () => {
    mocks.peekCachedText.mockImplementation(async (key: string) => {
      if (key.includes('page:skill:public')) return 'private';
      return null;
    });
    mocks.peekCachedResponse.mockResolvedValue(new Response('<html>stale public content</html>'));
    const { handle } = await import('../src/hooks.server');
    const resolve = privateResolve();

    const response = await handle({ event: skillEvent(), resolve } as never);
    const body = await response.text();

    expect(body).toContain('private response');
    expect(body).not.toContain('stale public content');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    expect(mocks.getCurrentSkillVisibility).not.toHaveBeenCalled();
    expect(mocks.peekCachedResponse).not.toHaveBeenCalled();
    expect(mocks.refreshCachedResponse).not.toHaveBeenCalled();
    expect(mocks.createAuth).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it.each([
    { 'set-cookie': 'test-session=private' },
    { 'X-Skillscat-Status-Override': '404' },
  ])('does not persist public-marked HTML with unsafe response headers: %j', async (headers) => {
    mocks.peekCachedText.mockResolvedValue('public');
    const { handle } = await import('../src/hooks.server');
    const resolve = vi.fn(async () => new Response('<html>unsafe cache candidate</html>', {
      headers: {
        'Content-Type': 'text/html',
        'X-Skillscat-Public-Skill-Cache': '1',
        ...headers,
      },
    }));
    const response = await handle({ event: skillEvent(), resolve } as never);
    await response.text();
    expect(mocks.putCachedResponse).not.toHaveBeenCalled();
    expect(mocks.putCachedText).not.toHaveBeenCalled();
  });

  it('falls back to a single D1 visibility lookup when the hint is missing and caches the result', async () => {
    const { handle } = await import('../src/hooks.server');
    const resolve = privateResolve();

    const response = await handle({ event: skillEvent(), resolve } as never);
    const body = await response.text();

    expect(body).toContain('private response');
    // The HTML cache peek and the auth-skip check share one resolution.
    expect(mocks.getCurrentSkillVisibility).toHaveBeenCalledTimes(1);
    expect(mocks.putCachedText).toHaveBeenCalledWith(
      expect.stringContaining('page:skill:public'),
      'private',
      expect.any(Number),
      expect.objectContaining({ contentType: 'text/plain; charset=utf-8' })
    );
    expect(mocks.createAuth).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('skips auth after a single D1 lookup when the uncached skill is public', async () => {
    mocks.getCurrentSkillVisibility.mockResolvedValue('public');
    const { handle } = await import('../src/hooks.server');
    const resolve = privateResolve();

    const response = await handle({ event: skillEvent(), resolve } as never);
    await response.text();

    expect(mocks.getCurrentSkillVisibility).toHaveBeenCalledTimes(1);
    expect(mocks.putCachedText).toHaveBeenCalledWith(
      expect.stringContaining('page:skill:public'),
      'public',
      expect.any(Number),
      expect.objectContaining({ contentType: 'text/plain; charset=utf-8' })
    );
    expect(mocks.createAuth).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
  });
});
