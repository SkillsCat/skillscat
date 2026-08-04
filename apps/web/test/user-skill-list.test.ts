import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { loadUserSkillsPage } from '../src/lib/server/user-skill-list';

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
}

class SqliteD1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL,
      stars INTEGER,
      last_commit_at INTEGER,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      owner_id TEXT,
      org_id TEXT
    );
    CREATE INDEX skills_owner_created_idx ON skills (owner_id, created_at);
    CREATE TABLE skill_submissions (
      user_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, skill_id)
    );
    CREATE INDEX skill_submissions_user_indexed_idx
      ON skill_submissions (user_id, indexed_at, skill_id);
    INSERT INTO skills (
      id, name, slug, description, visibility, stars, last_commit_at,
      updated_at, created_at, owner_id, org_id
    ) VALUES
      ('skill-a', 'Alpha', 'owner/alpha', 'Alpha skill', 'public', 1, NULL, 10, 10, NULL, NULL),
      ('skill-b', 'Beta', 'owner/beta', 'Beta skill', 'public', 2, NULL, 20, 20, NULL, NULL),
      ('skill-c', 'Charlie', 'owner/charlie', 'Charlie skill', 'public', 3, 35, 30, 30, NULL, NULL),
      ('skill-owned', 'Owned', 'user/owned', 'Owned skill', 'private', 0, NULL, 40, 40, 'user-1', NULL),
      ('skill-other', 'Other', 'other/skill', 'Other skill', 'public', 4, NULL, 50, 50, NULL, NULL);
    INSERT INTO skill_submissions (user_id, skill_id, submitted_at, indexed_at) VALUES
      ('user-1', 'skill-a', 100, 200),
      ('user-1', 'skill-b', 110, 200),
      ('user-1', 'skill-c', 120, 300),
      ('user-2', 'skill-other', 130, 400);
  `);
  return db;
}

describe('user skill list', () => {
  it('lists submitted skills by persisted time with stable pagination and an exact total', async () => {
    const sqlite = createDatabase();
    const db = new SqliteD1Database(sqlite) as never;

    const firstPage = await loadUserSkillsPage(db, 'user-1', {
      page: 1,
      limit: 2,
      view: 'submitted',
    });
    const secondPage = await loadUserSkillsPage(db, 'user-1', {
      page: 2,
      limit: 2,
      view: 'submitted',
    });

    expect(firstPage.skills.map((skill) => skill.id)).toEqual(['skill-c', 'skill-b']);
    expect(secondPage.skills.map((skill) => skill.id)).toEqual(['skill-a']);
    expect(firstPage.totalSubmitted).toBe(3);
    expect(firstPage.pagination).toEqual({
      currentPage: 1,
      totalPages: 2,
      totalItems: 3,
      itemsPerPage: 2,
    });
  });

  it('uses the user/time index for the submitted list without a temporary sort', () => {
    const sqlite = createDatabase();
    const plan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT s.id
      FROM skill_submissions ss
      INNER JOIN skills s ON s.id = ss.skill_id
      WHERE ss.user_id = ?
      ORDER BY ss.indexed_at DESC, ss.skill_id DESC
      LIMIT ? OFFSET ?
    `).all('user-1', 20, 0) as Array<{ detail: string }>;
    const details = plan.map((row) => row.detail).join('\n');

    expect(details).toContain('skill_submissions_user_indexed_idx');
    expect(details).not.toContain('USE TEMP B-TREE');
  });

  it('drops skills that turned private or unlisted from the submitted list', async () => {
    const sqlite = createDatabase();
    sqlite.exec(`
      UPDATE skills SET visibility = 'private' WHERE id = 'skill-b';
      UPDATE skills SET visibility = 'unlisted' WHERE id = 'skill-c';
    `);
    const db = new SqliteD1Database(sqlite) as never;

    const page = await loadUserSkillsPage(db, 'user-1', {
      page: 1,
      limit: 20,
      view: 'submitted',
    });

    expect(page.skills.map((skill) => skill.id)).toEqual(['skill-a']);
    // The badge, pagination, and the listing share one visible-only total.
    expect(page.totalSubmitted).toBe(1);
    expect(page.pagination.totalItems).toBe(1);
    expect(page.pagination.totalPages).toBe(1);
  });

  it('keeps later pages non-empty when some submitted skills turned private', async () => {
    const sqlite = createDatabase();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, visibility, stars, last_commit_at,
        updated_at, created_at, owner_id, org_id
      ) VALUES
        ('skill-d', 'Delta', 'owner/delta', 'Delta skill', 'public', 4, NULL, 60, 60, NULL, NULL),
        ('skill-e', 'Echo', 'owner/echo', 'Echo skill', 'public', 5, NULL, 70, 70, NULL, NULL);
      INSERT INTO skill_submissions (user_id, skill_id, submitted_at, indexed_at) VALUES
        ('user-1', 'skill-d', 140, 350),
        ('user-1', 'skill-e', 150, 500);
      UPDATE skills SET visibility = 'private' WHERE id IN ('skill-b', 'skill-d');
    `);
    const db = new SqliteD1Database(sqlite) as never;

    // 5 submission records, 3 still public: visible total > page size.
    const firstPage = await loadUserSkillsPage(db, 'user-1', {
      page: 1,
      limit: 2,
      view: 'submitted',
    });
    const secondPage = await loadUserSkillsPage(db, 'user-1', {
      page: 2,
      limit: 2,
      view: 'submitted',
    });

    expect(firstPage.skills.map((skill) => skill.id)).toEqual(['skill-e', 'skill-c']);
    expect(secondPage.skills.map((skill) => skill.id)).toEqual(['skill-a']);
    expect(firstPage.totalSubmitted).toBe(3);
    expect(firstPage.pagination).toEqual({
      currentPage: 1,
      totalPages: 2,
      totalItems: 3,
      itemsPerPage: 2,
    });
    expect(secondPage.pagination.totalPages).toBe(2);
  });
});
