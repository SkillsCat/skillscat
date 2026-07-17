import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';
import { detectRegistrySkillPlatform, parseRegistrySearchInput, resolveRegistrySearch } from '../src/lib/server/registry/search';

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

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

class LoggingSqliteD1Database {
  readonly queries: string[] = [];

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    this.queries.push(normalizeSql(sql));
    return new SqliteD1Statement(this.db, sql);
  }
}

function createRegistrySearchDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');

  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      repo_owner TEXT,
      repo_name TEXT,
      github_url TEXT,
      stars INTEGER NOT NULL DEFAULT 0,
      trending_score REAL NOT NULL DEFAULT 0,
      last_commit_at INTEGER,
      updated_at INTEGER,
      visibility TEXT NOT NULL,
      owner_id TEXT,
      org_id TEXT
    );

    CREATE TABLE authors (
      username TEXT PRIMARY KEY NOT NULL,
      avatar_url TEXT
    );

    CREATE TABLE skill_categories (
      skill_id TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      PRIMARY KEY (skill_id, category_slug)
    );

    CREATE TABLE org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL
    );

    CREATE TABLE skill_permissions (
      skill_id TEXT NOT NULL,
      grantee_type TEXT NOT NULL,
      grantee_id TEXT NOT NULL,
      expires_at INTEGER
    );
  `);

  return sqlite;
}

describe('parseRegistrySearchInput', () => {
  it('normalizes cli-style and tool-style inputs', () => {
    expect(
      parseRegistrySearchInput({
        query: '  react  ',
        category: 'UI-Components',
        limit: '500',
        offset: '-3',
        includePrivate: true,
      })
    ).toEqual({
      query: 'react',
      category: 'ui-components',
      limit: 100,
      offset: 0,
      includePrivate: true,
    });

    expect(
      parseRegistrySearchInput({
        q: 'svelte',
        category: 'not valid!',
        pageSize: '3',
        include_private: 'true',
      })
    ).toEqual({
      query: 'svelte',
      category: '',
      limit: 3,
      offset: 0,
      includePrivate: true,
    });
  });
});

describe('detectRegistrySkillPlatform', () => {
  it('detects gitlab urls and defaults to github', () => {
    expect(detectRegistrySkillPlatform('https://gitlab.com/org/repo')).toBe('gitlab');
    expect(detectRegistrySkillPlatform('https://github.com/org/repo')).toBe('github');
    expect(detectRegistrySkillPlatform(null)).toBe('github');
  });
});

describe('resolveRegistrySearch', () => {
  it('keeps an exact first-page total without count when loaded results prove there is no next page', async () => {
    const sqlite = createRegistrySearchDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, github_url, stars,
        trending_score, last_commit_at, updated_at, visibility
      ) VALUES
        ('skill-1', 'Demo One', 'demo-one', 'Demo helper', 'acme', 'one', 'https://github.com/acme/one', 10, 30, 1000, 1000, 'public'),
        ('skill-2', 'Demo Two', 'demo-two', 'Demo helper', 'acme', 'two', 'https://github.com/acme/two', 8, 20, 1000, 1000, 'public');
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const resolved = await resolveRegistrySearch({
      db: db as never,
      request: new Request('https://skills.cat/registry/search?q=demo&limit=2&offset=0'),
      locals: {} as App.Locals,
    }, {
      query: 'demo',
      category: '',
      limit: 2,
      offset: 0,
      includePrivate: false,
    });

    expect(resolved.data.total).toBe(2);
    expect(resolved.data.skills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2']);
    expect(db.queries.some((sql) => sql.includes('COUNT(*) as total'))).toBe(false);
  });

  it('derives an exact total for a non-empty final page without an extra count query', async () => {
    const sqlite = createRegistrySearchDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, github_url, stars,
        trending_score, last_commit_at, updated_at, visibility
      ) VALUES
        ('skill-1', 'Demo One', 'demo-one', 'Demo helper', 'acme', 'one', 'https://github.com/acme/one', 10, 30, 1000, 1000, 'public'),
        ('skill-2', 'Demo Two', 'demo-two', 'Demo helper', 'acme', 'two', 'https://github.com/acme/two', 8, 20, 1000, 1000, 'public'),
        ('skill-3', 'Demo Three', 'demo-three', 'Demo helper', 'acme', 'three', 'https://github.com/acme/three', 6, 10, 1000, 1000, 'public');
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const resolved = await resolveRegistrySearch({
      db: db as never,
      request: new Request('https://skills.cat/registry/search?q=demo&limit=2&offset=2'),
      locals: {} as App.Locals,
    }, {
      query: 'demo',
      category: '',
      limit: 2,
      offset: 2,
      includePrivate: false,
    });

    expect(resolved.data.total).toBe(3);
    expect(resolved.data.skills.map((skill) => skill.id)).toEqual(['skill-3']);
    expect(db.queries.some((sql) => sql.includes('COUNT(*) as total'))).toBe(false);
  });

  it('keeps the exact count query for out-of-range pages', async () => {
    const sqlite = createRegistrySearchDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, github_url, stars,
        trending_score, last_commit_at, updated_at, visibility
      ) VALUES
        ('skill-1', 'Demo One', 'demo-one', 'Demo helper', 'acme', 'one', 'https://github.com/acme/one', 10, 30, 1000, 1000, 'public'),
        ('skill-2', 'Demo Two', 'demo-two', 'Demo helper', 'acme', 'two', 'https://github.com/acme/two', 8, 20, 1000, 1000, 'public'),
        ('skill-3', 'Demo Three', 'demo-three', 'Demo helper', 'acme', 'three', 'https://github.com/acme/three', 6, 10, 1000, 1000, 'public');
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const resolved = await resolveRegistrySearch({
      db: db as never,
      request: new Request('https://skills.cat/registry/search?q=demo&limit=2&offset=4'),
      locals: {} as App.Locals,
    }, {
      query: 'demo',
      category: '',
      limit: 2,
      offset: 4,
      includePrivate: false,
    });

    expect(resolved.data.total).toBe(3);
    expect(resolved.data.skills).toEqual([]);
    expect(db.queries.some((sql) => sql.includes('COUNT(*) as total'))).toBe(true);
  });

  it('includes only private skills accessible through ownership, organization membership, or active sharing', async () => {
    const sqlite = createRegistrySearchDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, github_url, stars,
        trending_score, last_commit_at, updated_at, visibility, owner_id, org_id
      ) VALUES
        ('public', 'Public', 'public', '', 'acme', 'public', NULL, 1, 60, 1000, 1000, 'public', NULL, NULL),
        ('owned', 'Owned', 'owned', '', 'acme', 'owned', NULL, 1, 50, 1000, 1000, 'private', 'user-1', NULL),
        ('org', 'Org', 'org', '', 'acme', 'org', NULL, 1, 40, 1000, 1000, 'private', NULL, 'org-1'),
        ('shared', 'Shared', 'shared', '', 'acme', 'shared', NULL, 1, 30, 1000, 1000, 'private', NULL, NULL),
        ('expired', 'Expired', 'expired', '', 'acme', 'expired', NULL, 1, 20, 1000, 1000, 'private', NULL, NULL),
        ('other', 'Other', 'other', '', 'acme', 'other', NULL, 1, 10, 1000, 1000, 'private', 'user-2', NULL);

      INSERT INTO org_members (org_id, user_id) VALUES ('org-1', 'user-1');
      INSERT INTO skill_permissions (skill_id, grantee_type, grantee_id, expires_at) VALUES
        ('shared', 'user', 'user-1', ${Date.now() + 60_000}),
        ('expired', 'user', 'user-1', ${Date.now() - 60_000});
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const resolved = await resolveRegistrySearch({
      db: db as never,
      request: new Request('https://skills.cat/registry/search?include_private=true'),
      locals: {
        auth: async () => ({ user: { id: 'user-1' } }),
      } as App.Locals,
    }, {
      query: '',
      category: '',
      limit: 10,
      offset: 0,
      includePrivate: true,
    });

    expect(resolved.cacheStatus).toBe('BYPASS');
    expect(resolved.data.skills.map((skill) => skill.id)).toEqual([
      'public',
      'owned',
      'org',
      'shared',
    ]);
    expect(resolved.data.total).toBe(4);
  });
});
