import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

import { findSkillArchiveObjectKey, isSkillArchiveObjectKey } from '../src/lib/server/skill/archive';
import { restoreArchivedSkillFromR2 } from '../src/lib/server/skill/resurrection';

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

describe('skill archive helpers', () => {
  it('matches only the exact archived skill object key', () => {
    expect(isSkillArchiveObjectKey('archive/2026/03/skill-123.json', 'skill-123')).toBe(true);
    expect(isSkillArchiveObjectKey('archive/2026/03/skill-1234.json', 'skill-123')).toBe(false);
    expect(isSkillArchiveObjectKey('archive/2026/03/prefix-skill-123.json', 'skill-123')).toBe(false);
  });

  it('paginates archive listings until the exact skill archive is found', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({
        objects: [
          { key: 'archive/2026/01/skill-1234.json' },
        ],
        truncated: true,
        cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        objects: [
          { key: 'archive/2026/02/skill-123.json' },
        ],
        truncated: false,
        cursor: undefined,
      });

    const archivePath = await findSkillArchiveObjectKey({
      list,
    } as unknown as R2Bucket, 'skill-123');

    expect(archivePath).toBe('archive/2026/02/skill-123.json');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('restores archived skill content and categories back into active storage', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT,
        source_type TEXT,
        repo_owner TEXT,
        repo_name TEXT,
        skill_path TEXT,
        visibility TEXT,
        tier TEXT,
        stars INTEGER,
        last_commit_at INTEGER,
        last_accessed_at INTEGER,
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

      INSERT INTO categories (id, slug, name, description, type)
      VALUES
        ('cat-automation', 'automation', 'Automation', NULL, 'ai-suggested'),
        ('cat-git', 'git', 'Git', NULL, 'ai-suggested');

      INSERT INTO skills (
        id, slug, source_type, repo_owner, repo_name, skill_path, visibility, tier, stars, last_commit_at, updated_at, indexed_at
      ) VALUES (
        'skill-123',
        'alice/toolbox/.claude',
        'github',
        'alice',
        'toolbox',
        '.claude',
        'public',
        'archived',
        1,
        1712000000000,
        1712000000000,
        1712000000000
      );
    `);

    const puts: Array<{ key: string; value: string }> = [];
    const deletes: string[] = [];
    const r2 = {
      list: vi.fn(async () => ({
        objects: [{ key: 'archive/2026/02/skill-123.json' }],
        truncated: false,
        cursor: undefined,
      })),
      get: vi.fn(async (key: string) => {
        if (key !== 'archive/2026/02/skill-123.json') return null;
        return {
          async json() {
            return {
              categories: ['automation', 'git'],
              skillMdContent: '# Restored skill',
            };
          },
        } as R2ObjectBody;
      }),
      put: vi.fn(async (key: string, value: string) => {
        puts.push({ key, value });
      }),
      delete: vi.fn(async (key: string) => {
        deletes.push(key);
      }),
    };

    const restored = await restoreArchivedSkillFromR2({
      db: new SqliteD1Database(sqlite) as never,
      r2: r2 as unknown as R2Bucket,
      skillId: 'skill-123',
      stars: 42,
      now: 1713000000000,
    });

    expect(restored).toBe(true);
    expect(puts).toEqual([{
      key: 'skills/github/alice/toolbox/p:.claude/SKILL.md',
      value: '# Restored skill',
    }]);
    expect(deletes).toEqual(['archive/2026/02/skill-123.json']);
    expect(sqlite.prepare(`
      SELECT tier, stars, last_accessed_at, updated_at
      FROM skills
      WHERE id = 'skill-123'
    `).get()).toEqual({
      tier: 'cold',
      stars: 42,
      last_accessed_at: 1713000000000,
      updated_at: 1713000000000,
    });
    expect(sqlite.prepare(`
      SELECT category_slug
      FROM skill_categories
      WHERE skill_id = 'skill-123'
      ORDER BY category_slug ASC
    `).all()).toEqual([
      { category_slug: 'automation' },
      { category_slug: 'git' },
    ]);
    expect(sqlite.prepare(`
      SELECT category_slug, public_skill_count, max_freshness_ts
      FROM category_public_stats
      ORDER BY category_slug ASC
    `).all()).toEqual([
      {
        category_slug: 'automation',
        public_skill_count: 1,
        max_freshness_ts: 1712000000000,
      },
      {
        category_slug: 'git',
        public_skill_count: 1,
        max_freshness_ts: 1712000000000,
      },
    ]);
    expect(sqlite.prepare(`
      SELECT slug, skill_count
      FROM categories
      ORDER BY slug ASC
    `).all()).toEqual([
      {
        slug: 'automation',
        skill_count: 1,
      },
      {
        slug: 'git',
        skill_count: 1,
      },
    ]);
  });
});
