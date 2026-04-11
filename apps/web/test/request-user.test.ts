import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateApiToken = vi.fn();

vi.mock('$lib/server/auth/api', () => ({
  validateApiToken,
}));

describe('resolveTokenBackedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the request does not carry a bearer token', async () => {
    const { resolveTokenBackedUser } = await import('../src/lib/server/auth/request-user');

    const result = await resolveTokenBackedUser(new Request('https://skills.cat/skills/demo/skill'), undefined);

    expect(result).toBeNull();
    expect(validateApiToken).not.toHaveBeenCalled();
  });

  it('hydrates a user record for valid user tokens', async () => {
    validateApiToken.mockResolvedValue({
      id: 'token_1',
      userId: 'user_1',
      orgId: null,
      principalType: 'user',
      principalId: 'user_1',
      name: 'CLI token',
      scopes: ['read'],
      expiresAt: null,
    });

    const first = vi.fn().mockResolvedValue({
      id: 'user_1',
      name: 'Demo User',
      email: 'demo@example.com',
      emailVerified: 1,
      image: 'https://example.com/avatar.png',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
    });

    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first,
        })),
      })),
    } as unknown as D1Database;

    const { resolveTokenBackedUser } = await import('../src/lib/server/auth/request-user');
    const result = await resolveTokenBackedUser(new Request('https://skills.cat/skills/demo/skill', {
      headers: {
        Authorization: 'Bearer sk_demo_token',
      },
    }), db);

    expect(validateApiToken).toHaveBeenCalledWith('sk_demo_token', db);
    expect(result).toEqual({
      id: 'user_1',
      name: 'Demo User',
      email: 'demo@example.com',
      emailVerified: true,
      image: 'https://example.com/avatar.png',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
    });
  });

  it('ignores org-scoped tokens for SSR user hydration', async () => {
    validateApiToken.mockResolvedValue({
      id: 'token_2',
      userId: null,
      orgId: 'org_1',
      principalType: 'org',
      principalId: 'org_1',
      name: 'Org token',
      scopes: ['read'],
      expiresAt: null,
    });

    const db = {
      prepare: vi.fn(),
    } as unknown as D1Database;

    const { resolveTokenBackedUser } = await import('../src/lib/server/auth/request-user');
    const result = await resolveTokenBackedUser(new Request('https://skills.cat/skills/demo/skill', {
      headers: {
        Authorization: 'Bearer sk_org_token',
      },
    }), db);

    expect(result).toBeNull();
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
