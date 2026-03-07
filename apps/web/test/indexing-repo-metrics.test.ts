import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { syncRepoMetricsForGithubSkills } from '../workers/indexing';

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

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      repo_owner TEXT,
      repo_name TEXT,
      skill_path TEXT,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      source_type TEXT DEFAULT 'github'
    );
  `);
  return db;
}

describe('syncRepoMetricsForGithubSkills', () => {
  it('updates every GitHub skill row for the same repo in one repo-wide write', async () => {
    const sqlite = createDb();
    sqlite.exec(`
      INSERT INTO skills (id, repo_owner, repo_name, skill_path, stars, forks, source_type) VALUES
        ('root', 'backrunner', 'skillscat', '', 11, 2, 'github'),
        ('nested', 'backrunner', 'skillscat', 'agents/cursor', 17, 3, 'github'),
        ('upload', 'backrunner', 'skillscat', 'manual', 99, 20, 'upload'),
        ('other', 'backrunner', 'another', '', 5, 1, 'github');
    `);

    await syncRepoMetricsForGithubSkills(
      new SqliteD1Database(sqlite) as never,
      'backrunner',
      'skillscat',
      42,
      8
    );

    const rows = sqlite.prepare(`
      SELECT id, stars, forks, source_type
      FROM skills
      ORDER BY id ASC
    `).all() as Array<{
      id: string;
      stars: number;
      forks: number;
      source_type: string;
    }>;

    expect(rows).toEqual([
      { id: 'nested', stars: 42, forks: 8, source_type: 'github' },
      { id: 'other', stars: 5, forks: 1, source_type: 'github' },
      { id: 'root', stars: 42, forks: 8, source_type: 'github' },
      { id: 'upload', stars: 99, forks: 20, source_type: 'upload' },
    ]);
  });

  it('issues a single UPDATE statement without any read query', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async run() {
                calls.push({ sql, params });
                return { success: true };
              }
            };
          }
        };
      }
    };

    await syncRepoMetricsForGithubSkills(
      db as never,
      'backrunner',
      'skillscat',
      42,
      8
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('UPDATE skills');
    expect(calls[0].sql).not.toContain('SELECT');
    expect(calls[0].params).toEqual([42, 8, 'backrunner', 'skillscat', 42, 8]);
  });
});
