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
  mocks.putCachedText.mockResolvedValue(undefined);
  mocks.resolveTokenBackedIdentity.mockResolvedValue(null);
  mocks.runRequestSecurity.mockResolvedValue(null);
});

describe('skill HTML cache visibility hint', () => {
  it('serves cached public HTML without touching D1 when the hint says public', async () => {
    mocks.peekCachedText.mockImplementation(async (key: string) => {
      if (key.includes('page:skill:html')) return '<html>cached public content</html>';
      if (key.includes('page:skill:public')) return 'public';
      return null;
    });
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
      if (key.includes('page:skill:html')) return '<html>cached public content</html>';
      if (key.includes('page:skill:public')) return '1';
      return null;
    });
    const { handle } = await import('../src/hooks.server');
    const resolve = privateResolve();

    const response = await handle({ event: skillEvent(), resolve } as never);

    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(mocks.getCurrentSkillVisibility).not.toHaveBeenCalled();
  });

  it('does not serve cached public HTML when the cached hint says private, without touching D1', async () => {
    mocks.peekCachedText.mockImplementation(async (key: string) => {
      if (key.includes('page:skill:html')) return '<html>stale public content</html>';
      if (key.includes('page:skill:public')) return 'private';
      return null;
    });
    const { handle } = await import('../src/hooks.server');
    const resolve = privateResolve();

    const response = await handle({ event: skillEvent(), resolve } as never);
    const body = await response.text();

    expect(body).toContain('private response');
    expect(body).not.toContain('stale public content');
    expect(mocks.getCurrentSkillVisibility).not.toHaveBeenCalled();
    expect(mocks.createAuth).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
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
