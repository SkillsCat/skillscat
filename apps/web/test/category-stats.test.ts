import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  getCategoryStats,
  syncCategoryPublicStats,
} from '../src/lib/server/db/business/stats';

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

class SqliteD1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

function createCategoryStatsDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');

  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      visibility TEXT NOT NULL,
      last_commit_at INTEGER,
      updated_at INTEGER,
      indexed_at INTEGER
    );

    CREATE TABLE skill_categories (
      skill_id TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      PRIMARY KEY (skill_id, category_slug)
    );

    CREATE TABLE categories (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      suggested_by_skill_id TEXT,
      skill_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE category_public_stats (
      category_slug TEXT PRIMARY KEY NOT NULL,
      public_skill_count INTEGER NOT NULL DEFAULT 0,
      max_freshness_ts INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX skill_categories_category_skill_idx
      ON skill_categories (category_slug, skill_id);
  `);

  return sqlite;
}

describe('category public stats', () => {
  it('syncs snapshot rows and dynamic category counters from public skills only', async () => {
    const sqlite = createCategoryStatsDb();
    sqlite.exec(`
      INSERT INTO categories (id, slug, name, description, type)
      VALUES
        ('cat-custom-a', 'custom-a', 'Custom A', NULL, 'ai-suggested'),
        ('cat-custom-b', 'custom-b', 'Custom B', NULL, 'ai-suggested');

      INSERT INTO skills (id, visibility, last_commit_at, updated_at, indexed_at)
      VALUES
        ('skill-1', 'public', 2000, 1500, 1400),
        ('skill-2', 'private', 9000, 9000, 9000),
        ('skill-3', 'public', NULL, 4000, 3500);

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-1', 'custom-a'),
        ('skill-1', 'custom-b'),
        ('skill-2', 'custom-a'),
        ('skill-3', 'custom-a');
    `);

    const db = new SqliteD1Database(sqlite);
    await syncCategoryPublicStats(db as never, ['custom-a', 'custom-b'], 5000);

    expect(sqlite.prepare(`
      SELECT category_slug, public_skill_count, max_freshness_ts, updated_at
      FROM category_public_stats
      ORDER BY category_slug ASC
    `).all()).toEqual([
      {
        category_slug: 'custom-a',
        public_skill_count: 2,
        max_freshness_ts: 4000,
        updated_at: 5000,
      },
      {
        category_slug: 'custom-b',
        public_skill_count: 1,
        max_freshness_ts: 2000,
        updated_at: 5000,
      },
    ]);

    expect(sqlite.prepare(`
      SELECT slug, skill_count, updated_at
      FROM categories
      ORDER BY slug ASC
    `).all()).toEqual([
      {
        slug: 'custom-a',
        skill_count: 2,
        updated_at: 5000,
      },
      {
        slug: 'custom-b',
        skill_count: 1,
        updated_at: 5000,
      },
    ]);
  });

  it('backfills predefined category snapshot rows on first read', async () => {
    const sqlite = createCategoryStatsDb();
    sqlite.exec(`
      INSERT INTO skills (id, visibility, last_commit_at, updated_at, indexed_at)
      VALUES
        ('skill-1', 'public', 2200, 2100, 2000),
        ('skill-2', 'public', NULL, 3200, 3000),
        ('skill-3', 'private', 9999, 9999, 9999),
        ('skill-4', 'public', 2600, 2500, 2400);

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-1', 'git'),
        ('skill-2', 'git'),
        ('skill-3', 'git'),
        ('skill-4', 'security');
    `);

    const db = new SqliteD1Database(sqlite);
    const stats = await getCategoryStats({
      DB: db as never,
      R2: undefined,
    });

    expect(stats.git).toBe(2);
    expect(stats.security).toBe(1);
    expect(sqlite.prepare(`
      SELECT category_slug, public_skill_count
      FROM category_public_stats
      WHERE category_slug IN ('git', 'security')
      ORDER BY category_slug ASC
    `).all()).toEqual([
      {
        category_slug: 'git',
        public_skill_count: 2,
      },
      {
        category_slug: 'security',
        public_skill_count: 1,
      },
    ]);
  });
});
