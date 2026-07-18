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

beforeEach(() => {
  mocks.createAuth.mockReturnValue({
    api: { getSession: vi.fn(async () => null) },
  });
  mocks.getCurrentSkillVisibility.mockResolvedValue('private');
  mocks.peekCachedText.mockImplementation(async (key: string) => {
    if (key.includes('page:skill:html')) return '<html>stale public content</html>';
    if (key.includes('page:skill:public')) return '1';
    return null;
  });
  mocks.resolveTokenBackedIdentity.mockResolvedValue(null);
  mocks.runRequestSecurity.mockResolvedValue(null);
});

describe('skill HTML cache visibility guard', () => {
  it('does not let a stale public hint bypass authentication for a private skill', async () => {
    const { handle } = await import('../src/hooks.server');
    const url = new URL('https://skills.cat/skills/acme/private-skill');
    const event = {
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
    const resolve = vi.fn(async () => new Response('<html>private response</html>', {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-cache',
      },
    }));

    const response = await handle({ event, resolve } as never);
    const body = await response.text();

    expect(body).toContain('private response');
    expect(body).not.toContain('stale public content');
    expect(mocks.getCurrentSkillVisibility).toHaveBeenCalledTimes(2);
    expect(mocks.createAuth).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
  });
});
