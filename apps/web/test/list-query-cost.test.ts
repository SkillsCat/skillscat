import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { getTrendingSkillsPaginated } from '../src/lib/server/db/business/lists';

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
}

class LoggingSqliteD1Database {
  readonly queries: string[] = [];

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    this.queries.push(sql.replace(/\s+/g, ' ').trim());
    return new SqliteD1Statement(this.db, sql);
  }
}

function createListDb(): DatabaseSync {
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
      last_commit_at INTEGER,
      updated_at INTEGER NOT NULL,
      visibility TEXT NOT NULL
    );
    CREATE INDEX skills_visibility_id_idx ON skills (visibility, id);
    CREATE INDEX skills_visibility_trending_desc_idx
      ON skills (visibility, trending_score DESC);
    CREATE INDEX skills_public_trending_id_idx
      ON skills (trending_score DESC, id)
      WHERE visibility = 'public';

    CREATE TABLE authors (
      username TEXT PRIMARY KEY NOT NULL,
      avatar_url TEXT
    );
    CREATE INDEX authors_username_idx ON authors (username);

    CREATE TABLE skill_categories (
      skill_id TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      PRIMARY KEY (skill_id, category_slug)
    );

    WITH RECURSIVE seq(n) AS (
      SELECT 1
      UNION ALL
      SELECT n + 1 FROM seq WHERE n < 30
    )
    INSERT INTO skills (
      id, name, slug, repo_owner, repo_name, stars, forks,
      trending_score, last_commit_at, updated_at, visibility
    )
    SELECT
      printf('skill-%02d', n),
      printf('Skill %02d', n),
      printf('skill-%02d', n),
      'owner',
      'repo',
      n,
      0,
      n,
      1000,
      1000,
      'public'
    FROM seq;
  `);
  return sqlite;
}

describe('public list query cost guards', () => {
  it('serves deeper pages covered by the R2 ranking snapshot', async () => {
    const sqlite = createListDb();
    const db = new LoggingSqliteD1Database(sqlite);
    const cachedSkills = Array.from({ length: 30 }, (_, index) => {
      const rank = 30 - index;
      return {
        id: `skill-${String(rank).padStart(2, '0')}`,
        name: `Skill ${String(rank).padStart(2, '0')}`,
        slug: `skill-${String(rank).padStart(2, '0')}`,
        description: null,
        repoOwner: 'owner',
        repoName: 'repo',
        stars: rank,
        forks: 0,
        trendingScore: rank,
        updatedAt: 1000,
      };
    });
    const r2 = {
      get: async (key: string) => key === 'cache/trending.json'
        ? {
            text: async () => JSON.stringify({
              data: cachedSkills,
              generatedAt: Date.now(),
            }),
          }
        : null,
    };

    const result = await getTrendingSkillsPaginated(
      { DB: db as never, R2: r2 as never },
      2,
      5
    );

    expect(result.skills.map((skill) => skill.id)).toEqual([
      'skill-25',
      'skill-24',
      'skill-23',
      'skill-22',
      'skill-21',
    ]);
    expect(db.queries.some((sql) => sql.includes('WITH ranked AS'))).toBe(false);
  });

  it('limits ranked skills before joining author rows', async () => {
    const sqlite = createListDb();
    const db = new LoggingSqliteD1Database(sqlite);

    const result = await getTrendingSkillsPaginated(
      { DB: db as never, R2: undefined },
      1,
      5
    );

    expect(result.skills.map((skill) => skill.id)).toEqual([
      'skill-30',
      'skill-29',
      'skill-28',
      'skill-27',
      'skill-26',
    ]);
    const listQuery = db.queries.find((sql) => sql.includes('WITH ranked AS'));
    expect(listQuery).toContain('INDEXED BY skills_public_trending_id_idx');
    expect(listQuery?.indexOf('LIMIT ? OFFSET ?')).toBeLessThan(listQuery?.indexOf('LEFT JOIN authors') ?? 0);

    const plan = sqlite.prepare(`
      EXPLAIN QUERY PLAN
      WITH ranked AS (
        SELECT
          id,
          name,
          slug,
          description,
          repo_owner as repoOwner,
          repo_name as repoName,
          stars,
          forks,
          trending_score as trendingScore,
          COALESCE(last_commit_at, updated_at) as updatedAt
        FROM skills INDEXED BY skills_public_trending_id_idx
        WHERE visibility = 'public'
        ORDER BY trending_score DESC
        LIMIT 6 OFFSET 0
      )
      SELECT ranked.*, a.avatar_url as authorAvatar
      FROM ranked
      LEFT JOIN authors a INDEXED BY authors_username_idx
        ON ranked.repoOwner = a.username
    `).all() as { detail: string }[];

    expect(plan.some((row) => row.detail.includes('skills_public_trending_id_idx'))).toBe(true);
    expect(plan.some((row) => row.detail.includes('authors_username_idx'))).toBe(true);
    expect(plan.some((row) => /^SCAN skills$/u.test(row.detail))).toBe(false);
    expect(plan.some((row) => row.detail.includes('TEMP B-TREE'))).toBe(false);
  });

  it('rejects out-of-range offsets before scanning the ranked list', async () => {
    const sqlite = createListDb();
    const db = new LoggingSqliteD1Database(sqlite);

    await expect(getTrendingSkillsPaginated(
      { DB: db as never, R2: undefined },
      1_000_000,
      24
    )).resolves.toEqual({ skills: [], total: 30 });

    expect(db.queries.some((sql) => sql.includes('COUNT(*) as total'))).toBe(true);
    expect(db.queries.some((sql) => sql.includes('WITH ranked AS'))).toBe(false);
  });
});
