import { DatabaseSync } from 'node:sqlite';

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

class SqliteD1Statement {
  private params: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Database {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.sqlite, sql);
  }
}

function createDb(options: { withNotifications?: boolean } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      email TEXT
    );

    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL
    );

    INSERT INTO user (id, name, email) VALUES
      ('owner', 'Owner', 'owner@example.com'),
      ('grantee', 'Grantee User', 'Grantee@Example.com');

    INSERT INTO skills (id, name, slug) VALUES
      ('skill-1', 'Cool Skill', 'cool-skill');
  `);

  if (options.withNotifications !== false) {
    sqlite.exec(`
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        metadata TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );
    `);
  }

  return new SqliteD1Database(sqlite);
}

const db = createDb() as unknown as D1Database;

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

function userAuth(userId: string, name: string) {
  return {
    userId,
    orgId: null,
    principalType: 'user',
    principalId: userId,
    user: { id: userId, name },
    authMethod: 'session',
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


describe('skill share notifications', () => {
  function shareAsOwner(db: D1Database, body: unknown) {
    return import('../src/routes/api/skills/[id]/share/+server').then(({ POST }) => POST({
      locals: {},
      platform: { env: { DB: db } },
      params: { id: 'skill-1' },
      request: request('POST', body),
    } as never));
  }

  function notificationsFor(database: SqliteD1Database, userId: string) {
    return database.sqlite.prepare(`
      SELECT user_id, type, title, message, metadata
      FROM notifications WHERE user_id = ?
    `).all(userId) as Array<{
      user_id: string;
      type: string;
      title: string;
      message: string | null;
      metadata: string | null;
    }>;
  }

  it('creates a skill_shared notification with full metadata for a userId grant', async () => {
    const database = createDb();
    mocks.getAuthContext.mockResolvedValueOnce(userAuth('owner', 'Owner'));

    const response = await shareAsOwner(database as unknown as D1Database, {
      userId: 'grantee',
      permission: 'write',
      expiresInDays: 30,
    });

    expect(response.status).toBe(200);
    const rows = notificationsFor(database, 'grantee');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('skill_shared');
    expect(rows[0].title).toBe('Skill shared: Cool Skill');
    expect(rows[0].message).toBe('Owner shared "Cool Skill" with you with write access.');
    expect(JSON.parse(rows[0].metadata!)).toEqual({
      skillId: 'skill-1',
      skillSlug: 'cool-skill',
      skillName: 'Cool Skill',
      sharerId: 'owner',
      sharerName: 'Owner',
      permission: 'write',
      expiresAt: expect.any(Number),
    });
  });

  it('resolves email grants to registered users case-insensitively', async () => {
    const database = createDb();
    mocks.getAuthContext.mockResolvedValueOnce(userAuth('owner', 'Owner'));

    const response = await shareAsOwner(database as unknown as D1Database, {
      email: 'grantee@example.com',
    });

    expect(response.status).toBe(200);
    const rows = notificationsFor(database, 'grantee');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('skill_shared');
    expect(JSON.parse(rows[0].metadata!)).toMatchObject({
      skillId: 'skill-1',
      skillSlug: 'cool-skill',
      skillName: 'Cool Skill',
      sharerId: 'owner',
      sharerName: 'Owner',
      permission: 'read',
      expiresAt: null,
    });
  });

  it('does not create a notification when the email matches no registered user', async () => {
    const database = createDb();
    mocks.getAuthContext.mockResolvedValueOnce(userAuth('owner', 'Owner'));

    const response = await shareAsOwner(database as unknown as D1Database, {
      email: 'stranger@example.com',
    });

    expect(response.status).toBe(200);
    expect(mocks.grantSkillPermission).toHaveBeenCalledWith(
      'skill-1',
      'email',
      'stranger@example.com',
      'read',
      'owner',
      expect.anything(),
      undefined
    );
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM notifications`).get())
      .toEqual({ count: 0 });
  });

  it('does not notify the sharer when sharing with themselves', async () => {
    const database = createDb();
    mocks.getAuthContext.mockResolvedValueOnce(userAuth('owner', 'Owner'));

    const response = await shareAsOwner(database as unknown as D1Database, { userId: 'owner' });

    expect(response.status).toBe(200);
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM notifications`).get())
      .toEqual({ count: 0 });
  });

  it('still succeeds when notification creation fails', async () => {
    const database = createDb({ withNotifications: false });
    mocks.getAuthContext.mockResolvedValueOnce(userAuth('owner', 'Owner'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await shareAsOwner(database as unknown as D1Database, { userId: 'grantee' });

      expect(response.status).toBe(200);
      expect(mocks.grantSkillPermission).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
