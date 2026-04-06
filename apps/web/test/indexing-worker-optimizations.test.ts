import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';

import {
  extractStoredFileShas,
  getExistingSkillSnapshot,
  queueDiscoveredSkillPaths,
} from '../workers/indexing';
import type { IndexingMessage } from '../workers/shared/types';

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
}

class SqliteD1Database {
  public prepareCalls = 0;

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    this.prepareCalls += 1;
    return new SqliteD1Statement(this.db, sql);
  }
}

class MemoryKv {
  private readonly store = new Map<string, string>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

function createIndexingMessage(): IndexingMessage {
  return {
    type: 'check_skill',
    repoOwner: 'backrunner',
    repoName: 'skillscat',
  };
}

describe('indexing worker snapshot lookup', () => {
  it('loads the stored skill snapshot in one query and reuses file_structure data', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL,
        source_type TEXT NOT NULL,
        visibility TEXT NOT NULL,
        repo_owner TEXT,
        repo_name TEXT,
        skill_path TEXT,
        stars INTEGER NOT NULL,
        commit_sha TEXT,
        file_structure TEXT,
        last_commit_at INTEGER,
        skill_md_first_commit_at INTEGER,
        repo_created_at INTEGER,
        created_at INTEGER NOT NULL,
        indexed_at INTEGER
      );
    `);
    sqlite.prepare(`
      INSERT INTO skills (
        id, slug, source_type, visibility, repo_owner, repo_name, skill_path, stars,
        commit_sha, file_structure, last_commit_at, skill_md_first_commit_at,
        repo_created_at, created_at, indexed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'skill-1',
      'backrunner/skillscat/cursor',
      'github',
      'public',
      'backrunner',
      'skillscat',
      'agents/cursor',
      42,
      'sha-123',
      JSON.stringify({
        files: [
          { path: 'SKILL.md', sha: 'blob-skill' },
          { path: 'README.md', sha: 'blob-readme' },
        ],
      }),
      1710000000000,
      1700000000000,
      1690000000000,
      1680000000000,
      1715000000000
    );

    const db = new SqliteD1Database(sqlite);
    const snapshot = await getExistingSkillSnapshot(
      'backrunner',
      'skillscat',
      'agents/cursor',
      { DB: db } as never
    );

    expect(db.prepareCalls).toBe(1);
    expect(snapshot).toEqual(expect.objectContaining({
      id: 'skill-1',
      slug: 'backrunner/skillscat/cursor',
      sourceType: 'github',
      visibility: 'public',
      repoOwner: 'backrunner',
      repoName: 'skillscat',
      skillPath: 'agents/cursor',
      stars: 42,
      commitSha: 'sha-123',
      lastCommitAt: 1710000000000,
      skillMdFirstCommitAt: 1700000000000,
      repoCreatedAt: 1690000000000,
      createdAt: 1680000000000,
      indexedAt: 1715000000000,
      fileStructure: JSON.stringify({
        files: [
          { path: 'SKILL.md', sha: 'blob-skill' },
          { path: 'README.md', sha: 'blob-readme' },
        ],
      }),
    }));

    expect(
      Array.from(extractStoredFileShas(snapshot?.fileStructure || null, 'backrunner/skillscat').entries())
    ).toEqual([
      ['SKILL.md', 'blob-skill'],
      ['README.md', 'blob-readme'],
    ]);
  });
});

describe('queueDiscoveredSkillPaths', () => {
  it('suppresses duplicate discovered path enqueues while the first batch is still pending', async () => {
    const kv = new MemoryKv();
    const send = vi.fn(async () => undefined);

    const queuedFirst = await queueDiscoveredSkillPaths(
      createIndexingMessage(),
      'backrunner',
      'skillscat',
      'sha-123',
      ['agents/cursor', 'agents/opencode'],
      {
        KV: kv,
        INDEXING_QUEUE: { send },
      } as never
    );

    const queuedSecond = await queueDiscoveredSkillPaths(
      createIndexingMessage(),
      'backrunner',
      'skillscat',
      'sha-123',
      ['agents/cursor', 'agents/opencode'],
      {
        KV: kv,
        INDEXING_QUEUE: { send },
      } as never
    );

    expect(queuedFirst).toBe(2);
    expect(queuedSecond).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({ skillPath: 'agents/cursor' }));
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({ skillPath: 'agents/opencode' }));
  });

  it('clears the pending marker when enqueue fails so the path can be retried', async () => {
    const kv = new MemoryKv();
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(
      queueDiscoveredSkillPaths(
        createIndexingMessage(),
        'backrunner',
        'skillscat',
        'sha-123',
        ['agents/cursor'],
        {
          KV: kv,
          INDEXING_QUEUE: { send },
        } as never
      )
    ).rejects.toThrow('queue unavailable');

    await expect(
      queueDiscoveredSkillPaths(
        createIndexingMessage(),
        'backrunner',
        'skillscat',
        'sha-123',
        ['agents/cursor'],
        {
          KV: kv,
          INDEXING_QUEUE: { send },
        } as never
      )
    ).resolves.toBe(1);

    expect(send).toHaveBeenCalledTimes(2);
  });
});
