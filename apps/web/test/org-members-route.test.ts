import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { invalidateCache } = vi.hoisted(() => ({
  invalidateCache: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  invalidateCache,
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

  async batch(statements: SqliteD1Statement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function createDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      email TEXT,
      image TEXT
    );

    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT,
      owner_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE org_members (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE authors (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL,
      user_id TEXT,
      display_name TEXT
    );

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

    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL
    );

    CREATE TABLE api_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE
    );

    INSERT INTO user (id, name, email) VALUES
      ('owner', 'Owner', 'owner@example.com'),
      ('invitee', 'Invitee', 'invitee@example.com');
    INSERT INTO organizations (id, name, slug, display_name, owner_id, updated_at)
      VALUES ('org-1', 'Acme', 'acme', 'Acme Inc.', 'owner', 1);
    INSERT INTO org_members (org_id, user_id, role, joined_at)
      VALUES ('org-1', 'owner', 'owner', 1);
    INSERT INTO authors (id, username, user_id, display_name)
      VALUES ('author-invitee', 'invitee', 'invitee', 'Invitee');
  `);

  return new SqliteD1Database(sqlite);
}

function session(userId: string, name = userId) {
  return {
    auth: vi.fn(async () => ({ user: { id: userId, name } })),
  };
}

function invitationMetadata() {
  return JSON.stringify({
    orgId: 'org-1',
    orgSlug: 'acme',
    orgName: 'Acme Inc.',
    inviterId: 'owner',
    inviterName: 'Owner',
    role: 'member',
  });
}

function insertInvitation(db: SqliteD1Database, processed = 0) {
  db.sqlite.prepare(`
    INSERT INTO notifications (
      id, user_id, type, title, message, metadata, read, processed, created_at
    ) VALUES (?, ?, 'org_invite', 'Join Acme', NULL, ?, 0, ?, 1)
  `).run('invite-1', 'invitee', invitationMetadata(), processed);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('organization invitations', () => {
  it('returns 400 for malformed member requests', async () => {
    const db = createDb();
    const { POST } = await import('../src/routes/api/orgs/[slug]/members/+server');

    await expect(POST({
      locals: session('owner', 'Owner'),
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      }),
    } as never)).rejects.toMatchObject({ status: 400 });
  });

  it('resolves GitHub usernames case-insensitively', async () => {
    const db = createDb();
    const { POST } = await import('../src/routes/api/orgs/[slug]/members/+server');

    const response = await POST({
      locals: session('owner', 'Owner'),
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ githubUsername: 'InViTeE' }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare(`
      SELECT user_id, processed FROM notifications WHERE type = 'org_invite'
    `).get()).toEqual({ user_id: 'invitee', processed: 0 });
  });

  it('rejects a duplicate pending invitation using the conditional insert', async () => {
    const db = createDb();
    insertInvitation(db);
    const { POST } = await import('../src/routes/api/orgs/[slug]/members/+server');

    await expect(POST({
      locals: session('owner', 'Owner'),
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ githubUsername: 'invitee' }),
      }),
    } as never)).rejects.toMatchObject({ status: 409 });

    expect(db.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM notifications WHERE processed = 0
    `).get()).toEqual({ count: 1 });
  });

  it('accepts an invitation atomically and adds the member', async () => {
    const db = createDb();
    insertInvitation(db);
    const { POST } = await import('../src/routes/api/notifications/[id]/accept/+server');

    const response = await POST({
      locals: session('invitee'),
      platform: { env: { DB: db } },
      params: { id: 'invite-1' },
    } as never);

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare(`
      SELECT role, invited_by FROM org_members WHERE org_id = 'org-1' AND user_id = 'invitee'
    `).get()).toEqual({ role: 'member', invited_by: 'owner' });
    expect(db.sqlite.prepare(`
      SELECT processed, read FROM notifications WHERE id = 'invite-1'
    `).get()).toEqual({ processed: 1, read: 1 });
    expect(db.sqlite.prepare(`
      SELECT updated_at FROM organizations WHERE id = 'org-1'
    `).get()).toEqual({ updated_at: expect.any(Number) });
    expect(invalidateCache).toHaveBeenCalledOnce();
  });

  it('processes an invitation without duplicating an existing member', async () => {
    const db = createDb();
    db.sqlite.prepare(`
      INSERT INTO org_members (org_id, user_id, role, invited_by, joined_at)
      VALUES ('org-1', 'invitee', 'member', 'owner', 1)
    `).run();
    insertInvitation(db);
    const { POST } = await import('../src/routes/api/notifications/[id]/accept/+server');

    const response = await POST({
      locals: session('invitee'),
      platform: { env: { DB: db } },
      params: { id: 'invite-1' },
    } as never);

    expect(await response.json()).toMatchObject({
      success: true,
      message: 'You are already a member of this organization',
    });
    expect(db.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM org_members WHERE org_id = 'org-1' AND user_id = 'invitee'
    `).get()).toEqual({ count: 1 });
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it('keeps rejected invitations terminal', async () => {
    const db = createDb();
    insertInvitation(db);
    const { POST: rejectInvite } = await import('../src/routes/api/notifications/[id]/reject/+server');
    const { PATCH } = await import('../src/routes/api/notifications/[id]/+server');

    await rejectInvite({
      locals: session('invitee'),
      platform: { env: { DB: db } },
      params: { id: 'invite-1' },
    } as never);

    await expect(PATCH({
      locals: session('invitee'),
      platform: { env: { DB: db } },
      params: { id: 'invite-1' },
      request: new Request('https://skills.cat/api/notifications/invite-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ processed: false }),
      }),
    } as never)).rejects.toMatchObject({ status: 400 });

    expect(db.sqlite.prepare(`
      SELECT processed FROM notifications WHERE id = 'invite-1'
    `).get()).toEqual({ processed: 1 });
  });
});

describe('organization member removal', () => {
  it('lets the owner remove a member and invalidates the organization snapshot', async () => {
    const db = createDb();
    db.sqlite.prepare(`
      INSERT INTO org_members (org_id, user_id, role, invited_by, joined_at)
      VALUES ('org-1', 'invitee', 'member', 'owner', 2)
    `).run();
    const { DELETE } = await import('../src/routes/api/orgs/[slug]/members/+server');

    const response = await DELETE({
      locals: session('owner'),
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme/members', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'invitee' }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare(`
      SELECT 1 FROM org_members WHERE org_id = 'org-1' AND user_id = 'invitee'
    `).get()).toBeUndefined();
    expect(db.sqlite.prepare(`
      SELECT updated_at FROM organizations WHERE id = 'org-1'
    `).get()).not.toEqual({ updated_at: 1 });
    expect(invalidateCache).toHaveBeenCalledOnce();
  });

  it('lets a member leave without exposing their user ID to the client', async () => {
    const db = createDb();
    db.sqlite.prepare(`
      INSERT INTO org_members (org_id, user_id, role, invited_by, joined_at)
      VALUES ('org-1', 'invitee', 'member', 'owner', 2)
    `).run();
    const { DELETE } = await import('../src/routes/api/orgs/[slug]/members/+server');

    const response = await DELETE({
      locals: session('invitee'),
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
      request: new Request('https://skills.cat/api/orgs/acme/members', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare(`
      SELECT 1 FROM org_members WHERE org_id = 'org-1' AND user_id = 'invitee'
    `).get()).toBeUndefined();
  });
});

describe('organization deletion', () => {
  it('keeps the organization intact when it still owns a skill', async () => {
    const db = createDb();
    db.sqlite.prepare(`INSERT INTO skills (id, org_id) VALUES ('skill-1', 'org-1')`).run();
    const { DELETE } = await import('../src/routes/api/orgs/[slug]/+server');

    await expect(DELETE({
      locals: session('owner'),
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
    } as never)).rejects.toMatchObject({ status: 409 });

    expect(db.sqlite.prepare(`SELECT id FROM organizations WHERE id = 'org-1'`).get()).toEqual({ id: 'org-1' });
    expect(db.sqlite.prepare(`SELECT role FROM org_members WHERE org_id = 'org-1'`).get()).toEqual({ role: 'owner' });
  });

  it('deletes an empty organization and cascades members and tokens', async () => {
    const db = createDb();
    db.sqlite.prepare(`INSERT INTO api_tokens (id, org_id) VALUES ('token-1', 'org-1')`).run();
    const { DELETE } = await import('../src/routes/api/orgs/[slug]/+server');

    const response = await DELETE({
      locals: session('owner'),
      platform: { env: { DB: db } },
      params: { slug: 'acme' },
    } as never);

    expect(response.status).toBe(200);
    expect(db.sqlite.prepare(`SELECT id FROM organizations WHERE id = 'org-1'`).get()).toBeUndefined();
    expect(db.sqlite.prepare(`SELECT user_id FROM org_members WHERE org_id = 'org-1'`).get()).toBeUndefined();
    expect(db.sqlite.prepare(`SELECT id FROM api_tokens WHERE org_id = 'org-1'`).get()).toBeUndefined();
  });
});

describe('notification listing', () => {
  it('returns null metadata instead of failing on malformed stored JSON', async () => {
    const db = createDb();
    db.sqlite.prepare(`
      INSERT INTO notifications (
        id, user_id, type, title, metadata, read, processed, created_at
      ) VALUES ('bad-json', 'invitee', 'skill_shared', 'Shared', '{broken', 0, 0, 1)
    `).run();
    const { GET } = await import('../src/routes/api/notifications/+server');

    const response = await GET({
      locals: session('invitee'),
      platform: { env: { DB: db } },
      url: new URL('https://skills.cat/api/notifications'),
    } as never);

    expect(await response.json()).toMatchObject({
      notifications: [{ id: 'bad-json', metadata: null }],
    });
  });
});
