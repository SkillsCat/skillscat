import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assessSkillQuality, QUALITY_MAX_CONTENT_CHARS, qualityFilePaths } from '../src/lib/server/skill/quality';
import { filterQualityEligibleSkills } from '../src/lib/server/skill/quality-discovery';
import { backfillSkillQuality, QUALITY_BACKFILL_BATCH_SIZE } from '../workers/shared/quality-backfill';
import { getRecentSkills, getRecentSkillsPaginated } from '../src/lib/server/db/business/lists';

const stub = `---
name: browser-example
---
# 浏览器任务
## When to use
任务「网络状态」。
## How to execute
按 op 分派；顺序调用
## Verification
- 单元样例 4 条（cases 断言）
- 物理基底：按 calibration 对照（编译/运行/断言裁决）
## References
- 单元库：compiler_code_units.py「网络状态」`;

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE skills (
    id TEXT PRIMARY KEY, slug TEXT, name TEXT, description TEXT,
    visibility TEXT DEFAULT 'public', repo_owner TEXT, repo_name TEXT, skill_path TEXT,
    source_type TEXT DEFAULT 'upload', content_hash TEXT, commit_sha TEXT, file_structure TEXT,
    readme TEXT, stars INTEGER DEFAULT 0, forks INTEGER DEFAULT 0, trending_score REAL DEFAULT 0,
    download_count_90d INTEGER DEFAULT 0, download_count_30d INTEGER DEFAULT 0,
    first_published_at INTEGER, created_at INTEGER, indexed_at INTEGER, last_commit_at INTEGER, updated_at INTEGER
  );
  CREATE TABLE authors (username TEXT, avatar_url TEXT);
  CREATE INDEX authors_username_idx ON authors(username);
  CREATE INDEX skills_visibility_id_idx ON skills(visibility, id);
  CREATE TABLE skill_categories(skill_id TEXT, category_slug TEXT);`);
  // Exercise the Drizzle-generated migration, including its real partial indexes.
  sqlite.exec(readFileSync(new URL('../migrations/0035_productive_tombstone.sql', import.meta.url), 'utf8'));
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      let params: (string | number | null)[] = [];
      const stmt = {
        bind(...values: (string | number | null)[]) { params = values; return stmt; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }; },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { sqlite, db, queries };
}

describe('deterministic skill quality', () => {
  it('detects the audited generated wrapper by content and missing bundle implementation', () => {
    expect(assessSkillQuality(stub, ['SKILL.md'])).toMatchObject({ status: 'low_quality', reason: 'unbundled_generated_unit' });
    expect(assessSkillQuality(stub.replace('browser-example', 'helpful-skill'), ['SKILL.md']).status).toBe('low_quality');
  });
  it('allows a wrapper once its implementation is actually bundled', () => {
    expect(assessSkillQuality(stub, ['SKILL.md', 'compiler_code_units.py']).status).toBe('eligible');
  });
  it.each([
    '---\nname: browser-12345678\n---\n# Browser\nRun `curl -I https://example.com` and report the HTTP status.',
    '# 标题\n提交前先运行测试，失败时定位原因，修复后再提交。',
    '# Review\nCheck changes for correctness. Identify missing error handling and cite affected lines.',
    '# Setup\nRead compiler_code_units.py for examples. Install it from https://example.com/setup.',
    '# Backlog\nFind TODO comments and prioritize them by user impact.',
  ])('keeps useful concise instructions eligible: %s', (content) => {
    expect(assessSkillQuality(content, ['SKILL.md']).status).toBe('eligible');
  });
  it('rejects empty and placeholder scaffolds without treating fetch failures as low quality', () => {
    expect(assessSkillQuality('---\nname: empty\n---\n# Heading\n<!-- scaffold -->', ['SKILL.md']).reason).toBe('empty_instructions');
    expect(assessSkillQuality('# Heading\nTODO', ['SKILL.md']).reason).toBe('placeholder_instructions');
    expect(assessSkillQuality(null, []).status).toBe('pending');
    expect(assessSkillQuality(stub, []).status).toBe('pending');
    expect(assessSkillQuality('x'.repeat(QUALITY_MAX_CONTENT_CHARS + 1), []).status).toBe('pending');
  });
  it('reads both file manifest formats', () => {
    expect(qualityFilePaths(JSON.stringify({ files: [{ path: 'SKILL.md' }] }))).toEqual(['SKILL.md']);
    expect(qualityFilePaths(JSON.stringify([{ path: 'scripts', type: 'directory', children: [{ path: 'scripts/run.py', type: 'file' }] }]))).toEqual(['scripts/run.py']);
  });
});

describe('discovery quality and cost', () => {
  it('filters pending, low-quality and private entries from a stale recommendation payload in one query', async () => {
    const { sqlite, db, queries } = database();
    for (const [id, status, visibility] of [['good', 'eligible', 'public'], ['pending', 'pending', 'public'], ['bad', 'low_quality', 'public'], ['private', 'eligible', 'private']]) {
      sqlite.prepare('INSERT INTO skills(id, quality_status, visibility) VALUES (?, ?, ?)').run(id, status, visibility);
    }
    expect(await filterQualityEligibleSkills(db, ['bad', 'good', 'pending', 'private', 'deleted'].map((id) => ({ id })))).toEqual([{ id: 'good' }]);
    expect(queries).toHaveLength(1);
    sqlite.close();
  });
  it('keeps Recently chronological with no author or repository caps and correct pagination', async () => {
    const { sqlite, db } = database();
    for (let i = 1; i <= 30; i++) {
      sqlite.prepare(`INSERT INTO skills(id, slug, name, repo_owner, repo_name, quality_status, created_at)
        VALUES (?, ?, ?, 'one-author', 'one-repo', ?, ?)`).run(String(i), `one/repo/${i}`, `Skill ${i}`, i > 26 ? 'low_quality' : 'eligible', i);
    }
    expect((await getRecentSkills({ DB: db }, 12)).map((s) => s.id)).toEqual(Array.from({ length: 12 }, (_, i) => String(26 - i)));
    const first = await getRecentSkillsPaginated({ DB: db }, 1, 24);
    const second = await getRecentSkillsPaginated({ DB: db }, 2, 24);
    expect(first.total).toBe(26);
    expect(second.skills.map((s) => s.id)).toEqual(['2', '1']);
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id FROM skills INDEXED BY skills_discovery_recent_idx
      WHERE visibility = 'public' AND quality_status = 'eligible'
      ORDER BY CASE WHEN first_published_at IS NOT NULL THEN first_published_at WHEN created_at IS NOT NULL THEN created_at ELSE indexed_at END DESC, id LIMIT 24`).all();
    expect(JSON.stringify(plan)).toContain('skills_discovery_recent_idx');
    expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');
    sqlite.close();
  });
  it('uses fixed batches, no R2 reads for stored text, and never re-evaluates completed rows', async () => {
    const { sqlite, db } = database();
    for (let i = 0; i < 25; i++) sqlite.prepare(`INSERT INTO skills(id, readme, file_structure) VALUES (?, ?, ?)`)
      .run(String(i).padStart(2, '0'), stub, JSON.stringify({ files: [{ path: 'SKILL.md' }] }));
    const r2 = { get: vi.fn() };
    expect(await backfillSkillQuality({ DB: db, R2: r2 as unknown as R2Bucket }, 1000)).toBe(QUALITY_BACKFILL_BATCH_SIZE);
    expect(await backfillSkillQuality({ DB: db, R2: r2 as unknown as R2Bucket }, 1000)).toBe(5);
    expect(await backfillSkillQuality({ DB: db, R2: r2 as unknown as R2Bucket }, 1000)).toBe(0);
    expect(r2.get).not.toHaveBeenCalled();
    sqlite.close();
  });
  it('backs off missing content and prevents stale cached text from approving a newer version', async () => {
    const { sqlite, db } = database();
    sqlite.exec(`INSERT INTO skills(id, slug, content_hash) VALUES ('missing', 'owner/missing', NULL), ('stale', 'owner/stale', 'different-hash')`);
    const r2 = { get: vi.fn(async (key: string) => key.includes('stale') ? { size: 4, text: async () => 'Text' } : null) };
    await backfillSkillQuality({ DB: db, R2: r2 as unknown as R2Bucket }, 1000);
    expect(sqlite.prepare('SELECT quality_status, quality_reason FROM skills WHERE id = ?').get('stale')).toMatchObject({ quality_status: 'pending', quality_reason: 'content_hash_mismatch' });
    expect(await backfillSkillQuality({ DB: db, R2: r2 as unknown as R2Bucket }, 2000)).toBe(0);
    expect(r2.get).toHaveBeenCalledTimes(2);
    sqlite.close();
  });
  it('caps missing GitHub objects at two reads per candidate and defers retries', async () => {
    const { sqlite, db } = database();
    for (let i = 0; i < 30; i++) sqlite.prepare(`INSERT INTO skills(id, slug, source_type, repo_owner, repo_name)
      VALUES (?, ?, 'github', 'acme', 'repo')`).run(String(i), `acme/repo/${i}`);
    const r2 = { get: vi.fn(async () => null) };
    await backfillSkillQuality({ DB: db, R2: r2 as unknown as R2Bucket }, 1000);
    expect(r2.get).toHaveBeenCalledTimes(QUALITY_BACKFILL_BATCH_SIZE * 2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM skills WHERE quality_next_review_at > 1000').get()).toMatchObject({ n: 20 });
    sqlite.close();
  });
});
