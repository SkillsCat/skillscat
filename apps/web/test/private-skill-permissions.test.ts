import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';
import {
  canWriteSkill,
  checkSkillAccess,
  grantSkillPermission,
  revokeSkillPermission,
} from '../src/lib/server/auth/permissions';

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
    return {
      results: this.db.prepare(this.sql).all(...this.params) as T[],
    };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

function createDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      visibility TEXT NOT NULL,
      owner_id TEXT,
      org_id TEXT
    );

    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL
    );

    CREATE TABLE org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE skill_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      skill_id TEXT NOT NULL,
      grantee_type TEXT NOT NULL,
      grantee_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      UNIQUE (skill_id, grantee_type, grantee_id)
    );

    INSERT INTO skills (id, visibility, owner_id, org_id) VALUES
      ('personal', 'private', 'owner-1', NULL),
      ('org-skill', 'private', 'member-1', 'org-1'),
      ('former-org-skill', 'private', 'former-member', 'org-1'),
      ('shared', 'private', 'owner-1', NULL);

    INSERT INTO user (id, email) VALUES
      ('shared-user', 'Shared.User@example.com'),
      ('org-owner', 'owner@example.com');

    INSERT INTO org_members (org_id, user_id, role) VALUES
      ('org-1', 'org-owner', 'owner'),
      ('org-1', 'org-member', 'member'),
      ('org-1', 'member-1', 'member');
  `);

  return new SqliteD1Database(sqlite) as unknown as D1Database;
}

describe('private skill permissions', () => {
  it('honors email shares case-insensitively for reads and writes', async () => {
    const db = createDb();

    await grantSkillPermission(
      'shared',
      'email',
      'shared.user@EXAMPLE.com',
      'write',
      'owner-1',
      db
    );

    expect(await checkSkillAccess('shared', 'shared-user', db)).toBe(true);
    expect(await canWriteSkill('shared', 'shared-user', db)).toBe(true);
    expect(await revokeSkillPermission(
      'shared',
      'email',
      'shared.user@example.com',
      db
    )).toBe(true);
    expect(await checkSkillAccess('shared', 'shared-user', db)).toBe(false);
  });

  it('lets an organization token access and manage only its organization skills', async () => {
    const db = createDb();
    const orgPrincipal = { userId: null, orgId: 'org-1' };

    expect(await checkSkillAccess('org-skill', orgPrincipal, db)).toBe(true);
    expect(await canWriteSkill('org-skill', orgPrincipal, db)).toBe(true);
    expect(await checkSkillAccess('personal', orgPrincipal, db)).toBe(false);
    expect(await canWriteSkill('personal', orgPrincipal, db)).toBe(false);
  });

  it('lets organization owners manage member-uploaded skills without granting members write access', async () => {
    const db = createDb();

    expect(await canWriteSkill('org-skill', 'org-owner', db)).toBe(true);
    expect(await checkSkillAccess('org-skill', 'org-member', db)).toBe(true);
    expect(await canWriteSkill('org-skill', 'org-member', db)).toBe(false);
  });

  it('lets the current uploader manage an org skill but revokes implicit access after they leave', async () => {
    const db = createDb();

    expect(await checkSkillAccess('org-skill', 'member-1', db)).toBe(true);
    expect(await canWriteSkill('org-skill', 'member-1', db)).toBe(true);
    expect(await checkSkillAccess('former-org-skill', 'former-member', db)).toBe(false);
    expect(await canWriteSkill('former-org-skill', 'former-member', db)).toBe(false);
  });
});
