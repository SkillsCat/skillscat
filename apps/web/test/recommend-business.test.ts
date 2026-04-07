import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';
import {
  getRecommendedSkills,
  mergeRecommendCategorySeedSkillIds,
  orderRecommendDiscoveryCategories,
} from '../src/lib/server/db/business/recommend';

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

function createRecommendDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');

  sqlite.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      visibility TEXT NOT NULL,
      stars INTEGER NOT NULL DEFAULT 0,
      forks INTEGER NOT NULL DEFAULT 0,
      trending_score REAL NOT NULL DEFAULT 0,
      last_commit_at INTEGER,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE skill_categories (
      skill_id TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      PRIMARY KEY (skill_id, category_slug)
    );

    CREATE TABLE skill_tags (
      skill_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (skill_id, tag)
    );

    CREATE TABLE authors (
      username TEXT PRIMARY KEY NOT NULL,
      avatar_url TEXT
    );

    CREATE TABLE category_public_stats (
      category_slug TEXT PRIMARY KEY NOT NULL,
      public_skill_count INTEGER NOT NULL DEFAULT 0,
      top_skill_ids_json TEXT,
      max_freshness_ts INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX skills_visibility_id_idx
      ON skills (visibility, id);
    CREATE INDEX skills_visibility_trending_desc_idx
      ON skills (visibility, trending_score DESC);
    CREATE INDEX skills_repo_visibility_trending_idx
      ON skills (repo_owner, visibility, trending_score DESC);
    CREATE INDEX authors_username_idx
      ON authors (username);
    CREATE INDEX skill_categories_category_skill_idx
      ON skill_categories (category_slug, skill_id);
    CREATE INDEX skill_tags_tag_skill_idx
      ON skill_tags (tag, skill_id);
  `);

  return sqlite;
}

describe('orderRecommendDiscoveryCategories', () => {
  it('prioritizes rarer categories while keeping input order for ties', () => {
    const ordered = orderRecommendDiscoveryCategories(
      ['automation', 'coding', 'security', 'automation', 'agents'],
      new Map([
        ['automation', 1200],
        ['coding', 400],
        ['security', 400],
        ['agents', 80],
      ])
    );

    expect(ordered).toEqual(['agents', 'coding', 'security', 'automation']);
  });

  it('keeps unknown categories after known rarer categories', () => {
    const ordered = orderRecommendDiscoveryCategories(
      ['broad', 'unknown', 'niche'],
      new Map([
        ['broad', 5000],
        ['niche', 30],
      ])
    );

    expect(ordered).toEqual(['niche', 'broad', 'unknown']);
  });

  it('merges precomputed category seed ids without duplicates while boosting multi-category overlaps', () => {
    const merged = mergeRecommendCategorySeedSkillIds(
      ['niche', 'broad', 'unknown'],
      new Map([
        ['niche', ['skill_3', 'skill_2']],
        ['broad', ['skill_2', 'skill_1']],
        ['unknown', ['skill_9']],
      ]),
      10
    );

    expect(merged).toEqual(['skill_2', 'skill_3', 'skill_1', 'skill_9']);
  });

  it('prioritizes multi-category seed candidates before single-category trending tails', () => {
    const merged = mergeRecommendCategorySeedSkillIds(
      ['niche', 'mid', 'broad'],
      new Map([
        ['niche', ['skill_multi', 'skill_niche_only']],
        ['mid', ['skill_mid_only', 'skill_multi']],
        ['broad', ['skill_broad_only', 'skill_multi']],
      ]),
      4
    );

    expect(merged).toEqual(['skill_multi', 'skill_niche_only', 'skill_mid_only', 'skill_broad_only']);
  });

  it('keeps fallback category candidates when only part of the category stats have usable seeds', async () => {
    const sqlite = createRecommendDb();

    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, visibility,
        stars, forks, trending_score, last_commit_at, updated_at, indexed_at
      )
      VALUES
        ('skill-current', 'Current', 'current', NULL, 'owner-current', 'repo-current', 'public', 10, 1, 5, 1000, 1000, 1000),
        ('skill-seeded', 'Seeded', 'seeded', NULL, 'owner-seeded', 'repo-seeded', 'public', 80, 5, 40, 1000, 1000, 1000),
        ('skill-fallback', 'Fallback', 'fallback', NULL, 'owner-fallback', 'repo-fallback', 'public', 5, 1, 1, 1000, 1000, 1000),
        ('skill-hot-1', 'Hot 1', 'hot-1', NULL, 'owner-hot-1', 'repo-hot-1', 'public', 200, 10, 90, 1000, 1000, 1000),
        ('skill-hot-2', 'Hot 2', 'hot-2', NULL, 'owner-hot-2', 'repo-hot-2', 'public', 180, 9, 80, 1000, 1000, 1000),
        ('skill-hot-3', 'Hot 3', 'hot-3', NULL, 'owner-hot-3', 'repo-hot-3', 'public', 160, 8, 70, 1000, 1000, 1000),
        ('skill-hot-4', 'Hot 4', 'hot-4', NULL, 'owner-hot-4', 'repo-hot-4', 'public', 140, 7, 60, 1000, 1000, 1000),
        ('skill-hot-5', 'Hot 5', 'hot-5', NULL, 'owner-hot-5', 'repo-hot-5', 'public', 120, 6, 50, 1000, 1000, 1000);

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-current', 'seeded'),
        ('skill-current', 'fallback'),
        ('skill-seeded', 'seeded'),
        ('skill-fallback', 'fallback'),
        ('skill-hot-1', 'other'),
        ('skill-hot-2', 'other'),
        ('skill-hot-3', 'other'),
        ('skill-hot-4', 'other'),
        ('skill-hot-5', 'other');

      INSERT INTO category_public_stats (
        category_slug, public_skill_count, top_skill_ids_json, max_freshness_ts, updated_at
      )
      VALUES
        ('seeded', 2, '["skill-seeded"]', 1000, 1000);
    `);

    const results = await getRecommendedSkills(
      {
        DB: new SqliteD1Database(sqlite) as never,
        R2: undefined,
      },
      'skill-current',
      ['seeded', 'fallback'],
      '',
      2,
      undefined,
      false,
      []
    );

    expect(results).toHaveLength(2);
    expect(results.map((skill) => skill.id).sort()).toEqual(['skill-fallback', 'skill-seeded']);
  });

  it('supplements large-pool seeds with unseen multi-category matches', async () => {
    const sqlite = createRecommendDb();

    sqlite.exec(`
      INSERT INTO skills (
        id, name, slug, description, repo_owner, repo_name, visibility,
        stars, forks, trending_score, last_commit_at, updated_at, indexed_at
      )
      VALUES
        ('skill-current', 'Current', 'current', NULL, 'owner-current', 'repo-current', 'public', 10, 1, 5, 1000, 1000, 1000),
        ('skill-alpha-hot', 'Alpha Hot', 'alpha-hot', NULL, 'owner-alpha', 'repo-alpha', 'public', 300, 10, 100, 1000, 1000, 1000),
        ('skill-beta-hot', 'Beta Hot', 'beta-hot', NULL, 'owner-beta', 'repo-beta', 'public', 250, 9, 90, 1000, 1000, 1000),
        ('skill-multi', 'Multi Match', 'multi-match', NULL, 'owner-multi', 'repo-multi', 'public', 5, 1, 5, 1000, 1000, 1000);

      INSERT INTO skill_categories (skill_id, category_slug)
      VALUES
        ('skill-current', 'alpha'),
        ('skill-current', 'beta'),
        ('skill-alpha-hot', 'alpha'),
        ('skill-beta-hot', 'beta'),
        ('skill-multi', 'alpha'),
        ('skill-multi', 'beta');

      INSERT INTO category_public_stats (
        category_slug, public_skill_count, top_skill_ids_json, max_freshness_ts, updated_at
      )
      VALUES
        ('alpha', 3000, '["skill-alpha-hot"]', 1000, 1000),
        ('beta', 3000, '["skill-beta-hot"]', 1000, 1000);
    `);

    const results = await getRecommendedSkills(
      {
        DB: new SqliteD1Database(sqlite) as never,
        R2: undefined,
      },
      'skill-current',
      ['alpha', 'beta'],
      '',
      2,
      undefined,
      false,
      []
    );

    expect(results).toHaveLength(2);
    expect(results.map((skill) => skill.id)).toContain('skill-multi');
  });
});
