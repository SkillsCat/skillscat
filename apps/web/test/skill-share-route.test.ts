import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  requireScope: vi.fn(),
  canWriteSkill: vi.fn(),
  grantSkillPermission: vi.fn(),
  revokeSkillPermission: vi.fn(),
  listSkillPermissions: vi.fn(),
}));

vi.mock('../src/lib/server/auth/middleware', () => ({
  getAuthContext: mocks.getAuthContext,
  requireScope: mocks.requireScope,
}));

vi.mock('../src/lib/server/auth/permissions', () => ({
  canWriteSkill: mocks.canWriteSkill,
  grantSkillPermission: mocks.grantSkillPermission,
  revokeSkillPermission: mocks.revokeSkillPermission,
  listSkillPermissions: mocks.listSkillPermissions,
}));

const db = {} as D1Database;

function request(method: string, body?: unknown): Request {
  return new Request('https://skills.cat/api/skills/skill-1/share', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function orgAuth() {
  return {
    userId: null,
    orgId: 'org-1',
    principalType: 'org',
    principalId: 'org-1',
    user: null,
    authMethod: 'token',
    tokenInfo: null,
    scopes: ['read', 'write'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(orgAuth());
  mocks.canWriteSkill.mockResolvedValue(true);
  mocks.grantSkillPermission.mockResolvedValue('permission-1');
  mocks.revokeSkillPermission.mockResolvedValue(true);
  mocks.listSkillPermissions.mockResolvedValue([]);
});

describe('skill share route', () => {
  it('allows an organization token to grant a normalized email share', async () => {
    const { POST } = await import('../src/routes/api/skills/[id]/share/+server');
    const response = await POST({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('POST', {
        email: ' Shared.User@Example.COM ',
        permission: 'write',
        expiresInDays: 30,
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.requireScope).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }), 'write');
    expect(mocks.canWriteSkill).toHaveBeenCalledWith('skill-1', {
      userId: null,
      orgId: 'org-1',
    }, db);
    expect(mocks.grantSkillPermission).toHaveBeenCalledWith(
      'skill-1',
      'email',
      'shared.user@example.com',
      'write',
      'org-1',
      db,
      30
    );
  });

  it('lists shares only for a principal that can manage the skill', async () => {
    mocks.listSkillPermissions.mockResolvedValue([{
      id: 'permission-1',
      granteeType: 'user',
      granteeId: 'user-2',
      permission: 'read',
      grantedBy: 'org-1',
      createdAt: 1,
      expiresAt: null,
    }]);

    const { GET } = await import('../src/routes/api/skills/[id]/share/+server');
    const response = await GET({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('GET'),
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.requireScope).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }), 'read');
    await expect(response.json()).resolves.toEqual({
      success: true,
      permissions: [expect.objectContaining({ granteeId: 'user-2' })],
    });
  });

  it('revokes email shares case-insensitively through the route contract', async () => {
    const { DELETE } = await import('../src/routes/api/skills/[id]/share/+server');
    const response = await DELETE({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('DELETE', { email: ' Shared.User@Example.COM ' }),
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.revokeSkillPermission).toHaveBeenCalledWith(
      'skill-1',
      'email',
      'shared.user@example.com',
      db
    );
  });

  it('rejects unauthenticated and unauthorized share management', async () => {
    const { POST, GET } = await import('../src/routes/api/skills/[id]/share/+server');
    mocks.getAuthContext.mockResolvedValueOnce({ ...orgAuth(), orgId: null, principalId: null });

    await expect(POST({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('POST', { userId: 'user-2' }),
    } as never)).rejects.toMatchObject({ status: 401 });

    mocks.canWriteSkill.mockResolvedValueOnce(false);
    await expect(GET({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('GET'),
    } as never)).rejects.toMatchObject({ status: 403 });
    expect(mocks.listSkillPermissions).not.toHaveBeenCalled();
  });

  it('rejects ambiguous grantees and invalid expirations before writing', async () => {
    const { POST } = await import('../src/routes/api/skills/[id]/share/+server');

    await expect(POST({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('POST', { email: 'a@example.com', userId: 'user-2' }),
    } as never)).rejects.toMatchObject({ status: 400 });

    await expect(POST({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('POST', { email: 'a@example.com', expiresInDays: 366 }),
    } as never)).rejects.toMatchObject({ status: 400 });
    expect(mocks.grantSkillPermission).not.toHaveBeenCalled();
  });

  it('returns a client error for malformed or non-object JSON bodies', async () => {
    const { POST, DELETE } = await import('../src/routes/api/skills/[id]/share/+server');

    await expect(POST({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: new Request('https://skills.cat/api/skills/skill-1/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      }),
    } as never)).rejects.toMatchObject({ status: 400, body: { message: 'Invalid JSON body' } });

    await expect(DELETE({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('DELETE', null),
    } as never)).rejects.toMatchObject({
      status: 400,
      body: { message: 'JSON body must be an object' },
    });
  });
});
