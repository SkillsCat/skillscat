import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { getSkillsByCategory } from '../src/lib/server/db/business/lists';

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

  async run() {
    this.db.prepare(this.sql).run(...this.params);
    return { success: true };
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

function createCategoryListDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');

  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      repo_owner TEXT,
      repo_name TEXT,
      stars INTEGER NOT NULL DEFAULT 0,
      forks INTEGER NOT NULL DEFAULT 0,
      trending_score REAL NOT NULL DEFAULT 0,
      classification_method TEXT,
      last_commit_at INTEGER,
      updated_at INTEGER,
      visibility TEXT NOT NULL
    );

    CREATE INDEX skills_visibility_id_idx ON skills (visibility, id);

    CREATE TABLE authors (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL,
      avatar_url TEXT
    );
    CREATE INDEX authors_username_idx ON authors (username);

    CREATE TABLE skill_categories (
      skill_id TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      PRIMARY KEY (skill_id, category_slug)
    );
    CREATE INDEX skill_categories_category_skill_idx
      ON skill_categories (category_slug, skill_id);

    CREATE TABLE category_public_stats (
      category_slug TEXT PRIMARY KEY NOT NULL,
      public_skill_count INTEGER NOT NULL DEFAULT 0,
      top_ranked_skill_ids_json TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  return sqlite;
}

describe('getSkillsByCategory', () => {
  it('reuses precomputed ranked ids and stats totals for hot early pages', async () => {
    const sqlite = createCategoryListDb();
    sqlite.exec(`
      INSERT INTO authors (id, username, avatar_url)
      VALUES
        ('author-1', 'alice', 'https://img.example/alice.png'),
        ('author-2', 'bob', 'https://img.example/bob.png');

      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, stars, forks,
        trending_score, classification_method, last_commit_at, updated_at, visibility
      ) VALUES
        ('skill-1', 'Skill One', 'alice/skill-one', 'First', 'alice', 'repo-one', 10, 1, 50, 'ai', 1000, 1000, 'public'),
        ('skill-2', 'Skill Two', 'bob/skill-two', 'Second', 'bob', 'repo-two', 20, 2, 40, 'direct', 1000, 1000, 'public'),
        ('skill-3', 'Skill Three', 'alice/skill-three', 'Third', 'alice', 'repo-three', 30, 3, 30, 'keyword', 1000, 1000, 'public');

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-1', 'git'),
        ('skill-2', 'git'),
        ('skill-3', 'git');

      INSERT INTO category_public_stats (category_slug, public_skill_count, top_ranked_skill_ids_json, updated_at)
      VALUES ('git', 3, '["skill-2","skill-1","skill-3"]', 1234);
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const result = await getSkillsByCategory({ DB: db as never, R2: undefined }, 'git', 2, 0);

    expect(result.total).toBe(3);
    expect(result.skills.map((skill) => skill.id)).toEqual(['skill-2', 'skill-1']);
    expect(result.skills.map((skill) => skill.authorAvatar)).toEqual([
      'https://img.example/bob.png',
      'https://img.example/alice.png',
    ]);
    expect(db.queries.some((sql) => sql.includes('top_ranked_skill_ids_json'))).toBe(true);
    expect(db.queries.some((sql) => sql.includes('classificationRank'))).toBe(false);
    expect(db.queries.some((sql) => sql.includes('COUNT(*) as total'))).toBe(false);
  });

  it('falls back to live category reads when precomputed ids drift out of the category', async () => {
    const sqlite = createCategoryListDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, stars, forks,
        trending_score, classification_method, last_commit_at, updated_at, visibility
      ) VALUES
        ('skill-1', 'Skill One', 'alice/skill-one', 'First', 'alice', 'repo-one', 10, 1, 40, 'direct', 1000, 1000, 'public'),
        ('skill-2', 'Skill Two', 'bob/skill-two', 'Second', 'bob', 'repo-two', 20, 2, 30, 'ai', 1000, 1000, 'public'),
        ('skill-stale', 'Skill Stale', 'carol/skill-stale', 'Stale', 'carol', 'repo-stale', 30, 3, 90, 'direct', 1000, 1000, 'public');

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-1', 'git'),
        ('skill-2', 'git'),
        ('skill-stale', 'other');

      INSERT INTO category_public_stats (category_slug, public_skill_count, top_ranked_skill_ids_json, updated_at)
      VALUES ('git', 3, '["skill-stale","skill-1","skill-2"]', 1234);
    `);

    const db = new LoggingSqliteD1Database(sqlite);
    const result = await getSkillsByCategory({ DB: db as never, R2: undefined }, 'git', 2, 0);

    expect(result.total).toBe(2);
    expect(result.skills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2']);
    expect(db.queries.some((sql) => sql.includes('sc.skill_id IN'))).toBe(true);
    expect(db.queries.some((sql) => sql.includes('classificationRank'))).toBe(true);
  });

  it('does not trust stale snapshot totals for deeper pages', async () => {
    const sqlite = createCategoryListDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, stars, forks,
        trending_score, classification_method, last_commit_at, updated_at, visibility
      ) VALUES
        ('skill-1', 'Skill One', 'alice/skill-one', 'First', 'alice', 'repo-one', 10, 1, 40, 'direct', 1000, 1000, 'public'),
        ('skill-2', 'Skill Two', 'bob/skill-two', 'Second', 'bob', 'repo-two', 20, 2, 30, 'ai', 1000, 1000, 'public');

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-1', 'git'),
        ('skill-2', 'git');

      INSERT INTO category_public_stats (category_slug, public_skill_count, top_ranked_skill_ids_json, updated_at)
      VALUES ('git', 1, '["skill-1"]', 1234);
    `);

    const result = await getSkillsByCategory({ DB: new LoggingSqliteD1Database(sqlite) as never, R2: undefined }, 'git', 1, 1);

    expect(result.total).toBe(2);
    expect(result.skills.map((skill) => skill.id)).toEqual(['skill-2']);
  });
});
