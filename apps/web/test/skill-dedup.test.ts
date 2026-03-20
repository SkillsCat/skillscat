import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import {
  chooseCanonicalSkillCandidate,
  computeBundleManifestHash,
  computeSkillMdHashes,
  computeStandaloneSkillBundleHashes,
  convertPrivateSkillToPublicGithub,
  findSkillsByHashGroup,
} from '../src/lib/server/skill/dedup';

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

  async all<T>() {
    return {
      results: this.db.prepare(this.sql).all(...this.params) as T[],
    };
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
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

function createHashDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      slug TEXT NOT NULL,
      description TEXT,
      repo_owner TEXT,
      repo_name TEXT,
      skill_path TEXT,
      github_url TEXT,
      source_type TEXT NOT NULL,
      visibility TEXT NOT NULL,
      owner_id TEXT,
      org_id TEXT,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      content_hash TEXT,
      last_commit_at INTEGER,
      skill_md_first_commit_at INTEGER,
      repo_created_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      indexed_at INTEGER,
      file_structure TEXT,
      readme TEXT
    );

    CREATE TABLE content_hashes (
      id TEXT PRIMARY KEY NOT NULL,
      skill_id TEXT NOT NULL,
      hash_type TEXT NOT NULL,
      hash_value TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX content_hashes_unique_idx
      ON content_hashes (skill_id, hash_type);
    CREATE INDEX content_hashes_lookup_idx
      ON content_hashes (hash_type, hash_value);
  `);
  return db;
}

describe('skill dedup helpers', () => {
  it('keeps the bundle hash stable when SKILL.md only differs by formatting', async () => {
    const compact = '# Agent\n\nUse the tool.\n';
    const spaced = '  # Agent\r\n\r\nUse the tool.\r\n';
    const compactHashes = await computeSkillMdHashes(compact);
    const spacedHashes = await computeSkillMdHashes(spaced);

    expect(compactHashes.fullHash).not.toBe(spacedHashes.fullHash);
    expect(compactHashes.normalizedHash).toBe(spacedHashes.normalizedHash);

    const leftBundle = await computeBundleManifestHash([
      { path: 'SKILL.md', sha: compactHashes.fullHash, size: compact.length, type: 'text' },
      { path: 'templates/prompt.txt', sha: 'prompt-sha', size: 12, type: 'text' },
    ], compactHashes.normalizedHash);
    const rightBundle = await computeBundleManifestHash([
      { path: 'skill.md', sha: spacedHashes.fullHash, size: spaced.length, type: 'text' },
      { path: 'templates/prompt.txt', sha: 'prompt-sha', size: 12, type: 'text' },
    ], spacedHashes.normalizedHash);

    expect(leftBundle).toBe(rightBundle);
  });

  it('treats different companion files as distinct bundles even when SKILL.md matches', async () => {
    const hashes = await computeStandaloneSkillBundleHashes('# Agent\n\nUse the tool.\n');

    const leftBundle = await computeBundleManifestHash([
      { path: 'SKILL.md', sha: hashes.fullHash, size: 24, type: 'text' },
      { path: 'templates/prompt.txt', sha: 'prompt-a', size: 12, type: 'text' },
    ], hashes.normalizedHash);
    const rightBundle = await computeBundleManifestHash([
      { path: 'SKILL.md', sha: hashes.fullHash, size: 24, type: 'text' },
      { path: 'templates/prompt.txt', sha: 'prompt-b', size: 12, type: 'text' },
    ], hashes.normalizedHash);

    expect(leftBundle).not.toBe(rightBundle);
  });

  it('matches legacy rows without bundle_manifest and backfills the missing hash', async () => {
    const sqlite = createHashDb();
    const db = new SqliteD1Database(sqlite) as never;
    const skillMd = '# Agent\n\nUse the tool.\n';
    const hashes = await computeSkillMdHashes(skillMd);
    const bundleManifestHash = await computeBundleManifestHash([
      { path: 'SKILL.md', sha: 'legacy-skill-sha', size: skillMd.length, type: 'text' },
      { path: 'templates/prompt.txt', sha: 'prompt-sha', size: 18, type: 'text' },
    ], hashes.normalizedHash);

    sqlite.exec(`
      INSERT INTO skills (
        id, slug, repo_owner, repo_name, skill_path, source_type, visibility,
        stars, created_at, file_structure, readme
      ) VALUES (
        'legacy-skill',
        'demo/repo/claude',
        'demo',
        'repo',
        '.claude',
        'github',
        'public',
        10,
        1710000000000,
        '{"files":[{"path":"SKILL.md","sha":"legacy-skill-sha","size":24,"type":"text"},{"path":"templates/prompt.txt","sha":"prompt-sha","size":18,"type":"text"}]}',
        '# Agent\\n\\nUse the tool.\\n'
      );

      INSERT INTO content_hashes (id, skill_id, hash_type, hash_value, created_at) VALUES
        ('hash-normalized', 'legacy-skill', 'normalized', '${hashes.normalizedHash}', 1710000000000);
    `);

    const matches = await findSkillsByHashGroup(db, hashes.normalizedHash, bundleManifestHash, {
      visibility: 'public',
      sourceType: 'github',
    });

    expect(matches.map((match) => match.id)).toEqual(['legacy-skill']);
    expect(sqlite.prepare(`
      SELECT hash_value
      FROM content_hashes
      WHERE skill_id = 'legacy-skill'
        AND hash_type = 'bundle_manifest'
    `).get()).toEqual({
      hash_value: bundleManifestHash,
    });
  });

  it('prefers the earliest SKILL.md first commit when choosing a canonical skill', () => {
    const canonical = chooseCanonicalSkillCandidate([
      {
        id: 'copy',
        slug: 'later-copy',
        repoOwner: 'copycat',
        repoName: 'toolbox',
        skillPath: '.claude',
        sourceType: 'github',
        visibility: 'public',
        stars: 200,
        lastCommitAt: 1_730_000_000_000,
        skillMdFirstCommitAt: 1_720_000_000_000,
        repoCreatedAt: 1_719_000_000_000,
        createdAt: 1_731_000_000_000,
        indexedAt: 1_731_000_000_000,
      },
      {
        id: 'original',
        slug: 'original-author',
        repoOwner: 'origin',
        repoName: 'toolbox',
        skillPath: '.claude',
        sourceType: 'github',
        visibility: 'public',
        stars: 10,
        lastCommitAt: 1_735_000_000_000,
        skillMdFirstCommitAt: 1_710_000_000_000,
        repoCreatedAt: 1_709_000_000_000,
        createdAt: 1_736_000_000_000,
        indexedAt: 1_736_000_000_000,
      },
    ]);

    expect(canonical?.id).toBe('original');
  });

  it('converts a private upload into a GitHub-backed public skill during curation', async () => {
    const sqlite = createHashDb();
    const db = new SqliteD1Database(sqlite) as never;

    sqlite.exec(`
      INSERT INTO skills (
        id, slug, source_type, visibility, owner_id, created_at, indexed_at, readme
      ) VALUES (
        'private-upload',
        'alice/copied-skill',
        'upload',
        'private',
        'user_1',
        1710000000000,
        1710000000000,
        '# Agent'
      );
    `);

    await convertPrivateSkillToPublicGithub(db, {
      skillId: 'private-upload',
      name: 'Original Skill',
      description: 'Synced from GitHub',
      repoOwner: 'upstream',
      repoName: 'toolbox',
      skillPath: '.claude',
      githubUrl: 'https://github.com/upstream/toolbox',
      stars: 42,
      forks: 7,
      contentHash: 'content-hash',
      lastCommitAt: 1711000000000,
      skillMdFirstCommitAt: 1710500000000,
      repoCreatedAt: 1710000000000,
      indexedAt: 1712000000000,
      updatedAt: 1712000000000,
    });

    expect(sqlite.prepare(`
      SELECT
        name,
        description,
        repo_owner,
        repo_name,
        skill_path,
        github_url,
        source_type,
      visibility,
      stars,
      forks,
      content_hash,
      readme
      FROM skills
      WHERE id = 'private-upload'
    `).get()).toEqual({
      name: 'Original Skill',
      description: 'Synced from GitHub',
      repo_owner: 'upstream',
      repo_name: 'toolbox',
      skill_path: '.claude',
      github_url: 'https://github.com/upstream/toolbox',
      source_type: 'github',
      visibility: 'public',
      stars: 42,
      forks: 7,
      content_hash: 'content-hash',
      readme: null,
    });
  });
});
