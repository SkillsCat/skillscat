import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('../src/lib/server/auth/middleware');
});

describe('organization skills route', () => {
  it('lists private organization skills for a matching organization token', async () => {
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: async () => ({
        userId: null,
        orgId: 'org-1',
        principalType: 'org',
        principalId: 'org-1',
        user: null,
        authMethod: 'token',
        tokenInfo: null,
        scopes: ['read'],
      }),
      hasScope: (auth: { scopes: string[] }, scope: string) => auth.scopes.includes(scope),
      requireScope: (auth: { scopes: string[] }, scope: string) => {
        if (!auth.scopes.includes(scope)) throw new Error(`Missing scope: ${scope}`);
      },
    }));

    const rows = [
      {
        id: 'skill-private',
        name: 'Private Skill',
        slug: 'acme/private-skill',
        description: 'Private',
        visibility: 'private',
        stars: 0,
        updatedAt: 10,
      },
    ];

    const db = {
      prepare(sql: string) {
        return {
          bind(..._bindings: unknown[]) {
            return {
              async first<T>() {
                if (sql.includes('FROM organizations')) {
                  return { id: 'org-1' } as T;
                }
                return null;
              },
              async all<T>() {
                return { results: rows as T[] };
              },
            };
          },
        };
      },
    };

    const { GET } = await import('../src/routes/api/orgs/[slug]/skills/+server');
    const response = await GET({
      params: { slug: 'acme' },
      url: new URL('https://skills.cat/api/orgs/acme/skills?limit=20'),
      request: new Request('https://skills.cat/api/orgs/acme/skills', {
        headers: { Authorization: 'Bearer sk_org_token' },
      }),
      locals: {},
      platform: { env: { DB: db } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      skills: [{ slug: 'acme/private-skill', visibility: 'private' }],
    });
  });
});
