import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  getCategoryStats,
  getDynamicCategories,
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
  readonly queries: string[] = [];

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    this.queries.push(sql.replace(/\s+/g, ' ').trim());
    return new SqliteD1Statement(this.db, sql);
  }
}

function createCategoryStatsDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');

  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      visibility TEXT NOT NULL,
      classification_method TEXT,
      trending_score REAL NOT NULL DEFAULT 0,
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
      top_skill_ids_json TEXT,
      top_ranked_skill_ids_json TEXT,
      max_freshness_ts INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX skill_categories_category_skill_idx
      ON skill_categories (category_slug, skill_id);
    CREATE INDEX skills_visibility_id_idx
      ON skills (visibility, id);
    CREATE INDEX skills_visibility_trending_desc_idx
      ON skills (visibility, trending_score DESC);
    CREATE INDEX skills_public_trending_id_idx
      ON skills (trending_score DESC, id)
      WHERE visibility = 'public';
    CREATE INDEX skills_public_category_rank_idx
      ON skills (
        CASE
          WHEN classification_method = 'direct' THEN 0
          WHEN classification_method = 'ai' THEN 1
          WHEN classification_method = 'keyword' THEN 2
          ELSE 3
        END ASC,
        trending_score DESC,
        id
      )
      WHERE visibility = 'public';
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

      INSERT INTO skills (
        id, visibility, classification_method, trending_score, last_commit_at, updated_at, indexed_at
      )
      VALUES
        ('skill-1', 'public', 'direct', 10, 2000, 1500, 1400),
        ('skill-2', 'private', 'direct', 999, 9000, 9000, 9000),
        ('skill-3', 'public', 'ai', 100, NULL, 4000, 3500);

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
      SELECT
        category_slug,
        public_skill_count,
        top_skill_ids_json,
        top_ranked_skill_ids_json,
        max_freshness_ts,
        updated_at
      FROM category_public_stats
      ORDER BY category_slug ASC
    `).all()).toEqual([
      {
        category_slug: 'custom-a',
        public_skill_count: 2,
        top_skill_ids_json: '["skill-3","skill-1"]',
        top_ranked_skill_ids_json: '["skill-1","skill-3"]',
        max_freshness_ts: 4000,
        updated_at: 5000,
      },
      {
        category_slug: 'custom-b',
        public_skill_count: 1,
        top_skill_ids_json: '["skill-1"]',
        top_ranked_skill_ids_json: '["skill-1"]',
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

    // Both dynamic categories fall below the indexation threshold (8 skills).
    await expect(getDynamicCategories(db as never)).resolves.toEqual([]);
  });

  it('lists dynamic categories only once they reach the indexation threshold', async () => {
    const sqlite = createCategoryStatsDb();
    sqlite.exec(`
      INSERT INTO categories (id, slug, name, description, type)
      VALUES
        ('cat-big', 'big-cat', 'Big Cat', NULL, 'ai-suggested'),
        ('cat-small', 'small-cat', 'Small Cat', NULL, 'ai-suggested');

      INSERT INTO skills (
        id, visibility, classification_method, trending_score, last_commit_at, updated_at, indexed_at
      )
      VALUES
        ('skill-1', 'public', 'ai', 10, 2000, 1500, 1400),
        ('skill-2', 'public', 'ai', 10, 2000, 1500, 1400),
        ('skill-3', 'public', 'ai', 10, 2000, 1500, 1400),
        ('skill-4', 'public', 'ai', 10, 2000, 1500, 1400),
        ('skill-5', 'public', 'ai', 10, 2000, 1500, 1400),
        ('skill-6', 'public', 'ai', 10, 2000, 1500, 1400),
        ('skill-7', 'public', 'ai', 10, 2000, 1500, 1400),
        ('skill-8', 'public', 'ai', 10, 2000, 1500, 1400);

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-1', 'big-cat'),
        ('skill-2', 'big-cat'),
        ('skill-3', 'big-cat'),
        ('skill-4', 'big-cat'),
        ('skill-5', 'big-cat'),
        ('skill-6', 'big-cat'),
        ('skill-7', 'big-cat'),
        ('skill-8', 'big-cat'),
        ('skill-1', 'small-cat'),
        ('skill-2', 'small-cat'),
        ('skill-3', 'small-cat'),
        ('skill-4', 'small-cat'),
        ('skill-5', 'small-cat'),
        ('skill-6', 'small-cat'),
        ('skill-7', 'small-cat');
    `);

    const db = new SqliteD1Database(sqlite);
    await syncCategoryPublicStats(db as never, ['big-cat', 'small-cat'], 5000);

    await expect(getDynamicCategories(db as never)).resolves.toEqual([
      {
        slug: 'big-cat',
        name: 'Big Cat',
        description: null,
        type: 'ai-suggested',
        skillCount: 8,
      },
    ]);
  });

  it('uses ordered public-skill indexes for large category snapshots', async () => {
    const sqlite = createCategoryStatsDb();
    sqlite.exec(`
      INSERT INTO categories (id, slug, name, description, type)
      VALUES ('cat-broad', 'broad', 'Broad', NULL, 'ai-suggested');

      WITH RECURSIVE seq(n) AS (
        SELECT 1
        UNION ALL
        SELECT n + 1 FROM seq WHERE n < 4096
      )
      INSERT INTO skills (
        id, visibility, classification_method, trending_score,
        last_commit_at, updated_at, indexed_at
      )
      SELECT
        printf('skill-%05d', n),
        'public',
        CASE n % 3 WHEN 0 THEN 'direct' WHEN 1 THEN 'ai' ELSE 'keyword' END,
        5000 - n,
        1000,
        1000,
        1000
      FROM seq;

      INSERT INTO skill_categories (skill_id, category_slug)
      SELECT id, 'broad' FROM skills;
    `);

    const db = new SqliteD1Database(sqlite);
    await syncCategoryPublicStats(db as never, ['broad'], 5000);

    expect(db.queries.some((sql) => sql.includes('INDEXED BY skills_public_trending_id_idx'))).toBe(true);
    expect(db.queries.some((sql) => sql.includes('INDEXED BY skills_public_category_rank_idx'))).toBe(true);

    const trendingPlan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT s.id
      FROM skills s INDEXED BY skills_public_trending_id_idx
      WHERE s.visibility = 'public'
        AND EXISTS (
          SELECT 1
          FROM skill_categories sc
          WHERE sc.skill_id = s.id AND sc.category_slug = 'broad'
        )
      ORDER BY s.trending_score DESC
      LIMIT 96
    `).all() as { detail: string }[];
    expect(trendingPlan.some((row) => (
      row.detail.includes('COVERING INDEX skills_public_trending_id_idx')
    ))).toBe(true);
    expect(trendingPlan.some((row) => row.detail.includes('TEMP B-TREE'))).toBe(false);

    const plan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT s.id
      FROM skills s INDEXED BY skills_public_category_rank_idx
      WHERE s.visibility = 'public'
        AND EXISTS (
          SELECT 1
          FROM skill_categories sc
          WHERE sc.skill_id = s.id AND sc.category_slug = 'broad'
        )
      ORDER BY CASE
        WHEN s.classification_method = 'direct' THEN 0
        WHEN s.classification_method = 'ai' THEN 1
        WHEN s.classification_method = 'keyword' THEN 2
        ELSE 3
      END ASC,
      s.trending_score DESC
      LIMIT 96
    `).all() as { detail: string }[];

    expect(plan.some((row) => row.detail.includes('skills_public_category_rank_idx'))).toBe(true);
    expect(plan.some((row) => row.detail.includes('TEMP B-TREE'))).toBe(false);
  });

  it('backfills predefined category snapshot rows on first read', async () => {
    const sqlite = createCategoryStatsDb();
    sqlite.exec(`
      INSERT INTO skills (
        id, visibility, classification_method, trending_score, last_commit_at, updated_at, indexed_at
      )
      VALUES
        ('skill-1', 'public', 'direct', 50, 2200, 2100, 2000),
        ('skill-2', 'public', 'ai', 80, NULL, 3200, 3000),
        ('skill-3', 'private', 'direct', 999, 9999, 9999, 9999),
        ('skill-4', 'public', 'keyword', 30, 2600, 2500, 2400);

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
