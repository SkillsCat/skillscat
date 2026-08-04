import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';

import {
  getMessageDedupKey,
  getUserSubmissionContext,
  queueDiscoveredSkillPaths,
  recordPersistedUserSubmission,
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

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }
}

class SqliteD1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

class MemoryKv {
  private readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

function createMessage(overrides: Partial<IndexingMessage> = {}): IndexingMessage {
  return {
    type: 'check_skill',
    repoOwner: 'owner',
    repoName: 'repo',
    skillPath: '',
    submittedBy: 'user-1',
    submissionUserId: 'user-1',
    submittedAt: new Date(1_000).toISOString(),
    ...overrides,
  };
}

describe('indexing user submission attribution', () => {
  it('records only skills created after the request and remains duplicate-free', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE user (
        id TEXT PRIMARY KEY NOT NULL
      );
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        repo_owner TEXT,
        repo_name TEXT,
        skill_path TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE skill_submissions (
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        submitted_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, skill_id)
      );
      INSERT INTO user (id) VALUES ('user-1');
      INSERT INTO skills (id, repo_owner, repo_name, skill_path, created_at) VALUES
        ('skill-before', 'owner', 'repo', '', 900),
        ('skill-after', 'owner', 'repo', 'nested', 1100);
    `);

    const db = new SqliteD1Database(sqlite);
    const message = createMessage();

    await recordPersistedUserSubmission(db as never, message, 'skill-before');
    await recordPersistedUserSubmission(db as never, message, 'skill-after');
    await recordPersistedUserSubmission(db as never, message, 'skill-after');

    expect(sqlite.prepare(`
      SELECT user_id, skill_id, submitted_at, indexed_at
      FROM skill_submissions
    `).all()).toEqual([{
      user_id: 'user-1',
      skill_id: 'skill-after',
      submitted_at: 1_000,
      indexed_at: 1_100,
    }]);
  });

  it('recognizes only real user submissions and keeps submitters distinct during batch dedupe', () => {
    expect(getUserSubmissionContext(createMessage())).toEqual({
      userId: 'user-1',
      submittedAt: 1_000,
    });
    expect(getUserSubmissionContext(createMessage({
      submissionUserId: undefined,
      submittedBy: 'legacy-user',
    }))).toEqual({
      userId: 'legacy-user',
      submittedAt: 1_000,
    });
    expect(getUserSubmissionContext(createMessage({
      submissionUserId: undefined,
      submittedBy: 'anonymous_cli',
    }))).toBeNull();
    expect(getUserSubmissionContext(createMessage({
      submissionUserId: undefined,
      submittedBy: 'org:org-1',
    }))).toBeNull();
    expect(getUserSubmissionContext(createMessage({
      submissionUserId: undefined,
      submittedBy: 'security-analysis-backfill',
    }))).toBeNull();

    expect(getMessageDedupKey(createMessage()))
      .not.toBe(getMessageDedupKey(createMessage({
        submittedBy: 'user-2',
        submissionUserId: 'user-2',
      })));
    expect(getMessageDedupKey(createMessage()))
      .not.toBe(getMessageDedupKey(createMessage({
        submittedBy: 'User-1',
        submissionUserId: 'User-1',
      })));
  });

  it('keeps nested-path pending markers distinct for concurrent submitters', async () => {
    const kv = new MemoryKv();
    const send = vi.fn(async () => undefined);
    const env = {
      KV: kv,
      INDEXING_QUEUE: { send },
    } as never;
    const secondUserMessage = createMessage({
      submittedBy: 'user-2',
      submissionUserId: 'user-2',
    });
    const caseVariantMessage = createMessage({
      submittedBy: 'User-1',
      submissionUserId: 'User-1',
    });

    await expect(queueDiscoveredSkillPaths(
      createMessage(),
      'owner',
      'repo',
      'head-sha',
      ['nested'],
      env
    )).resolves.toBe(1);
    await expect(queueDiscoveredSkillPaths(
      secondUserMessage,
      'owner',
      'repo',
      'head-sha',
      ['nested'],
      env
    )).resolves.toBe(1);
    await expect(queueDiscoveredSkillPaths(
      caseVariantMessage,
      'owner',
      'repo',
      'head-sha',
      ['nested'],
      env
    )).resolves.toBe(1);
    await expect(queueDiscoveredSkillPaths(
      createMessage(),
      'owner',
      'repo',
      'head-sha',
      ['nested'],
      env
    )).resolves.toBe(0);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({
      skillPath: 'nested',
      submissionUserId: 'user-1',
    }));
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({
      skillPath: 'nested',
      submissionUserId: 'user-2',
    }));
    expect(send).toHaveBeenNthCalledWith(3, expect.objectContaining({
      skillPath: 'nested',
      submissionUserId: 'User-1',
    }));
  });

  it('attributes an already-processed nested path when it persisted after submission', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE user (
        id TEXT PRIMARY KEY NOT NULL
      );
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        repo_owner TEXT,
        repo_name TEXT,
        skill_path TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE skill_submissions (
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        submitted_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, skill_id)
      );
      INSERT INTO user (id) VALUES ('user-1');
      INSERT INTO skills (id, repo_owner, repo_name, skill_path, created_at)
      VALUES ('skill-nested', 'owner', 'repo', 'nested', 1100);
    `);
    const kv = new MemoryKv();
    await kv.put('indexing:processed:owner/repo:nested:head-sha', '1');
    const send = vi.fn(async () => undefined);

    await expect(queueDiscoveredSkillPaths(
      createMessage(),
      'owner',
      'repo',
      'head-sha',
      ['nested'],
      {
        DB: new SqliteD1Database(sqlite),
        KV: kv,
        INDEXING_QUEUE: { send },
      } as never
    )).resolves.toBe(0);

    expect(send).not.toHaveBeenCalled();
    expect(sqlite.prepare(`
      SELECT user_id, skill_id, submitted_at, indexed_at
      FROM skill_submissions
    `).all()).toEqual([{
      user_id: 'user-1',
      skill_id: 'skill-nested',
      submitted_at: 1_000,
      indexed_at: 1_100,
    }]);
  });

  it('records curation-converted private skills created before the submission', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE user (
        id TEXT PRIMARY KEY NOT NULL
      );
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        repo_owner TEXT,
        repo_name TEXT,
        skill_path TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE skill_submissions (
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        submitted_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, skill_id)
      );
      INSERT INTO user (id) VALUES ('user-1');
      INSERT INTO skills (id, repo_owner, repo_name, skill_path, created_at) VALUES
        ('skill-converted', 'owner', 'repo', '', 900);
    `);

    const db = new SqliteD1Database(sqlite);
    const message = createMessage();

    // The default guard refuses skills that predate the submission...
    await recordPersistedUserSubmission(db as never, message, 'skill-converted');
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM skill_submissions`).get())
      .toEqual({ count: 0 });

    // ...while the conversion path relaxes it exactly once, idempotently.
    await recordPersistedUserSubmission(db as never, message, 'skill-converted', {
      allowPreviouslyCreatedSkill: true,
    });
    await recordPersistedUserSubmission(db as never, message, 'skill-converted', {
      allowPreviouslyCreatedSkill: true,
    });

    expect(sqlite.prepare(`
      SELECT user_id, skill_id, submitted_at, indexed_at
      FROM skill_submissions
    `).all()).toEqual([{
      user_id: 'user-1',
      skill_id: 'skill-converted',
      submitted_at: 1_000,
      indexed_at: 900,
    }]);
  });
});
