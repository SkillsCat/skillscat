import { afterEach, describe, expect, it, vi } from 'vitest';

const { getOrgByLogin, getUserByLogin, getViewerOrgMembership, invalidateCache } = vi.hoisted(() => ({
  getOrgByLogin: vi.fn(),
  getUserByLogin: vi.fn(),
  getViewerOrgMembership: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/lib/server/github-client/rest', () => ({
  getOrgByLogin,
  getUserByLogin,
  getViewerOrgMembership,
}));

vi.mock('../src/lib/server/cache', () => ({
  invalidateCache,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createDb() {
  const batched: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT id FROM organizations')) {
        return {
          bind: () => ({ first: vi.fn(async () => null) }),
        };
      }

      if (sql.includes('SELECT access_token FROM account')) {
        return {
          bind: () => ({
            first: vi.fn(async () => ({ access_token: 'github-user-token' })),
          }),
        };
      }

      if (sql.includes('INSERT INTO organizations') || sql.includes('INSERT INTO org_members')) {
        return {
          bind: (...bindings: unknown[]) => ({ sql, bindings }),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }),
    batch: vi.fn(async (statements: Array<{ sql: string; bindings: unknown[] }>) => {
      batched.push(...statements);
      return [];
    }),
  };

  return { db, batched };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('organization creation', () => {
  it('returns 400 for malformed JSON', async () => {
    const { POST } = await import('../src/routes/api/orgs/+server');

    await expect(POST({
      locals: { auth: vi.fn(async () => ({ user: { id: 'user_owner' } })) },
      platform: { env: { DB: {} } },
      request: new Request('https://skills.cat/api/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      }),
    } as never)).rejects.toMatchObject({ status: 400 });
  });

  it('uses an explicit slug while preserving the human-readable display name', async () => {
    const { db, batched } = createDb();

    const { POST } = await import('../src/routes/api/orgs/+server');
    const response = await POST({
      locals: {
        auth: vi.fn(async () => ({ user: { id: 'user_owner', name: 'Owner' } })),
      },
      platform: { env: { DB: db } },
      request: new Request('https://skills.cat/api/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'My Organization', slug: 'My-Org' }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ slug: 'my-org' });
    expect(batched[0].bindings.slice(1, 4)).toEqual([
      'my-org',
      'my-org',
      'My Organization',
    ]);
    expect(invalidateCache).toHaveBeenCalledWith('page:org:snapshot:v1:my-org');
  });

  it('lets a GitHub organization admin claim and verify the matching namespace', async () => {
    getUserByLogin.mockResolvedValue(jsonResponse({
      id: 12345,
      avatar_url: 'https://avatars.example/acme.png',
      type: 'Organization',
    }));
    getViewerOrgMembership.mockResolvedValue(jsonResponse({
      role: 'admin',
      state: 'active',
    }));
    const { db, batched } = createDb();

    const { POST } = await import('../src/routes/api/orgs/+server');
    const response = await POST({
      locals: {
        auth: vi.fn(async () => ({
          user: { id: 'user_owner', name: 'Owner' },
        })),
      },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'github-app-token',
        },
      },
      request: new Request('https://skills.cat/api/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme' }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      slug: 'acme',
      verified: true,
    });
    expect(getViewerOrgMembership).toHaveBeenCalledWith('acme', {
      token: 'github-user-token',
      userAgent: 'SkillsCat/1.0',
    });
    expect(batched).toHaveLength(2);
    expect(batched[0].bindings).toEqual(expect.arrayContaining([
      12345,
      'https://avatars.example/acme.png',
      'user_owner',
    ]));
    expect(batched[0].bindings.some((value) => typeof value === 'number' && value > 1_000_000_000_000)).toBe(true);
  });

  it('rejects a matching GitHub organization claim from a non-admin', async () => {
    getUserByLogin.mockResolvedValue(jsonResponse({
      id: 12345,
      type: 'Organization',
    }));
    getViewerOrgMembership.mockResolvedValue(jsonResponse({
      role: 'member',
      state: 'active',
    }));
    const { db } = createDb();

    const { POST } = await import('../src/routes/api/orgs/+server');
    await expect(POST({
      locals: {
        auth: vi.fn(async () => ({ user: { id: 'user_member', name: 'Member' } })),
      },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'github-app-token',
        },
      },
      request: new Request('https://skills.cat/api/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme' }),
      }),
    } as never)).rejects.toMatchObject({ status: 403 });
  });
});

describe('organization verification', () => {
  it('invalidates the organization page snapshot after GitHub verification', async () => {
    getOrgByLogin.mockResolvedValue(jsonResponse({
      id: 12345,
      login: 'acme',
      avatar_url: 'https://avatars.example/acme.png',
    }));
    getViewerOrgMembership.mockResolvedValue(jsonResponse({
      role: 'admin',
      state: 'active',
    }));
    const updateRun = vi.fn(async () => ({ meta: { changes: 1 } }));
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT o.id, o.name, o.owner_id')) {
          return {
            bind: () => ({
              first: vi.fn(async () => ({
                id: 'org_acme',
                name: 'acme',
                owner_id: 'user_owner',
              })),
            }),
          };
        }
        if (sql.includes('SELECT access_token FROM account')) {
          return {
            bind: () => ({
              first: vi.fn(async () => ({ access_token: 'github-user-token' })),
            }),
          };
        }
        if (sql.includes('UPDATE organizations')) {
          return {
            bind: () => ({ run: updateRun }),
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const { POST } = await import('../src/routes/api/orgs/[slug]/verify/+server');
    const response = await POST({
      locals: {
        auth: vi.fn(async () => ({ user: { id: 'user_owner', name: 'Owner' } })),
      },
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
    } as never);

    expect(response.status).toBe(200);
    expect(updateRun).toHaveBeenCalledOnce();
    expect(invalidateCache).toHaveBeenCalledOnce();
  });
});

describe('organization update', () => {
  it('distinguishes omitted optional fields without binding undefined to D1', async () => {
    let updateBindings: unknown[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT om.role')) {
          return {
            bind: () => ({ first: vi.fn(async () => ({ role: 'owner' })) }),
          };
        }
        if (sql.includes('UPDATE organizations')) {
          return {
            bind: (...bindings: unknown[]) => {
              updateBindings = bindings;
              if (bindings.includes(undefined)) {
                throw new Error('D1_TYPE_ERROR');
              }
              return { run: vi.fn(async () => ({ meta: { changes: 1 } })) };
            },
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const { PUT } = await import('../src/routes/api/orgs/[slug]/+server');
    const response = await PUT({
      locals: {
        auth: vi.fn(async () => ({ user: { id: 'user_owner', name: 'Owner' } })),
      },
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Acme Updated' }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(updateBindings).toEqual([
      1,
      'Acme Updated',
      0,
      null,
      0,
      null,
      expect.any(Number),
      expect.any(Number),
      'acme',
    ]);
    expect(updateBindings[6]).toBe(updateBindings[7]);
  });

  it('clears nullable fields and rejects malformed JSON', async () => {
    let updateBindings: unknown[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT om.role')) {
          return {
            bind: () => ({ first: vi.fn(async () => ({ role: 'owner' })) }),
          };
        }
        if (sql.includes('UPDATE organizations')) {
          return {
            bind: (...bindings: unknown[]) => {
              updateBindings = bindings;
              return { run: vi.fn(async () => ({ meta: { changes: 1 } })) };
            },
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const { PUT } = await import('../src/routes/api/orgs/[slug]/+server');
    const context = {
      locals: { auth: vi.fn(async () => ({ user: { id: 'user_owner', name: 'Owner' } })) },
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
    };
    const response = await PUT({
      ...context,
      request: new Request('https://skills.cat/api/orgs/acme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: null, avatarUrl: null }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(updateBindings.slice(0, 6)).toEqual([0, null, 1, null, 1, null]);

    await expect(PUT({
      ...context,
      request: new Request('https://skills.cat/api/orgs/acme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      }),
    } as never)).rejects.toMatchObject({ status: 400 });
  });
});
