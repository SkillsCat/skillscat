import githubEventsWorker from '../workers/github-events';
import { seedMissingPrecomputeState } from '../workers/search-precompute';
import { getMessageDedupKey, queueDiscoveredSkillPaths } from '../workers/indexing';
import { markSearchDirty, markSearchDirtyBatch } from '../src/lib/server/ranking/search-precompute';
import { markRecommendDirty } from '../src/lib/server/ranking/recommend-precompute';
import { getRecentSkills, getTrendingSkillsPaginated } from '../src/lib/server/db/business/lists';
import { localizeSeoUrl, localizeStructuredData } from '../src/lib/seo/locale-path';
import { describe, expect, it, vi } from 'vitest';
import { createMigratedDb, createMemoryKv } from './helpers/migrated-db';
import { sanitizeSummary } from '../src/lib/seo/summary';
import { localizeHref, stripSeoLocale, isLocalizedPublicPath } from '../src/lib/seo/locale-path';
import { persistSkillLocalizations, readSkillLocalizations } from '../src/lib/server/seo/localizations';
import { loadRecentSkillsSitemapPages, loadSkillsSitemapPage } from '../src/lib/server/seo/sitemap';
import { firstPublishedSql, seoFreshnessSql } from '../src/lib/server/seo/freshness';
import { rankTrendingHead } from '../src/lib/server/ranking/trending-snapshot';
import { calculateTrendingScore } from '../workers/trending';
import { nextDiscoveryChannelState, withDiscoveryQueueBudget, recordDiscoveryStats, reserveDiscoveryAllowance, releaseDiscoveryAllowance } from '../workers/shared/discovery-budget';
import { generateSkillSummary } from '../workers/classification';

const en = 'Checks project dependencies for vulnerabilities. Use it before a release to review dependency risks.';
const zh = '检查项目依赖中的已知漏洞，帮助在发布前了解依赖风险。适用于准备版本发布或核查项目依赖的场景。';

describe('SEO content and locale contracts', () => {
  it('rejects analysis, malformed output, wrong language and incomplete descriptions', () => {
    for (const text of ['The user wants a summary. Let me analyze this skill.', '<think>Some analysis</think>', '{"en":"truncated', 'Checks dependencies and then', '以下是用户要求的摘要。这个技能可以检查项目依赖是否存在风险。']) {
      expect(sanitizeSummary(text)).toBeNull();
    }
    expect(sanitizeSummary(zh)).toBeNull();
    expect(sanitizeSummary(en, 'zh-CN')).toBeNull();
    expect(sanitizeSummary(en)).toBe(en);
    expect(sanitizeSummary(zh, 'zh-CN')).toBe(zh);
  });

  it('keeps API and private routes outside the Chinese route map', () => {
    expect(localizeHref('/recent?page=2', 'zh-CN')).toBe('/zh-CN/recent?page=2');
    expect(localizeHref('/zh-CN/recent?page=2', 'en')).toBe('/recent?page=2');
    expect(stripSeoLocale('/zh-CN')).toBe('/');
    expect(localizeHref('/api/skills/upload', 'zh-CN')).toBe('/api/skills/upload');
    expect(isLocalizedPublicPath('/zh-CN/user/tokens')).toBe(false);
    expect(localizeHref('/skills/acme/demo', 'zh-CN')).toBe('/skills/acme/demo');
    expect(localizeHref('/skills/acme/demo', 'zh-CN', true)).toBe('/zh-CN/skills/acme/demo');
  });

  it('never spends on paid fallback for introduction repair', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
    const { kv } = createMemoryKv();
    try {
      expect(await generateSkillSummary('source', null, { KV: kv, OPENROUTER_API_KEY: 'test', AI_MODEL: 'vendor/paid', FREE_MODELS: 'openrouter/free', CLASSIFICATION_PAID_MODEL: 'vendor/paid' } as never)).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).model).toBe('openrouter/free');
    } finally { fetch.mockRestore(); }
  });

  it('applies Drizzle migrations and publishes only current, validated Chinese content', async () => {
    const { sqlite, db } = createMigratedDb();
    const now = Date.now();
    sqlite.prepare(`INSERT INTO skills (id,name,slug,description,content_hash,created_at,indexed_at,last_commit_at) VALUES ('one','Audit','acme/audit',?, 'hash1', ?, ?, 1)`).run(en, now, now);
    expect(await persistSkillLocalizations(db, 'one', 'hash1', { en, 'zh-CN': zh }, now)).toBe(true);
    expect(await persistSkillLocalizations(db, 'one', 'hash1', { en, 'zh-CN': zh }, now + 100)).toBe(false);
    expect(await readSkillLocalizations(db, 'one', 'hash1')).toEqual({ en, 'zh-CN': zh });
    const recent = await loadRecentSkillsSitemapPages(db, now);
    expect(recent.map((page) => page.url)).toEqual(['/skills/acme/audit', '/zh-CN/skills/acme/audit']);
    expect(recent[0].lastmod).toBe(new Date(now).toISOString().slice(0, 10));
    sqlite.exec("UPDATE skills SET content_hash = 'hash2' WHERE id = 'one'");
    expect(await persistSkillLocalizations(db, 'one', 'hash1', { en, 'zh-CN': zh })).toBe(false);
    expect(await readSkillLocalizations(db, 'one', 'hash2')).toEqual({});
    expect((await loadSkillsSitemapPage(db, 1, '')).map((page) => page.url)).toEqual(['/skills/acme/audit']);
    sqlite.exec("UPDATE skills SET visibility = 'private' WHERE id = 'one'");
    expect(await loadSkillsSitemapPage(db, 1, '')).toEqual([]);
    sqlite.close();
  });

  it('uses expression indexes for first publication and SEO freshness', () => {
    const { sqlite } = createMigratedDb();
    for (const [expression, index] of [[firstPublishedSql(), 'skills_public_first_published_idx'], [seoFreshnessSql(), 'skills_public_seo_freshness_idx']]) {
      const plan = sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id FROM skills INDEXED BY ${index} WHERE visibility='public' AND (${expression}) > ? ORDER BY (${expression}) DESC LIMIT 48`).all(1000);
      expect(JSON.stringify(plan)).toContain(index);
      expect(JSON.stringify(plan)).not.toContain('USE TEMP B-TREE');
    }
    sqlite.close();
  });
});

describe('discovery and ranking budgets', () => {
  it('gives a new zero-star skill a nonzero discovery score', () => {
    expect(calculateTrendingScore({ stars: 0, starSnapshots: [], indexedAt: Date.now(), lastCommitAt: Date.now() })).toBeGreaterThan(0);
  });
  it('keeps the trending head diverse, stable and exposes new entries', () => {
    const now = Date.now();
    const rows = Array.from({ length: 240 }, (_, i) => ({ id: String(i), name: `Skill ${i}`, slug: `owner/${i}`, description: en,
      repoOwner: `owner${Math.floor(i / 10)}`, repoName: 'repo', stars: 1, forks: 0, trendingScore: 240 - i,
      updatedAt: 1, authorAvatar: null, publishedAt: i >= 220 ? now : 1 }));
    const ranked = rankTrendingHead(rows, now);
    expect(ranked).toEqual(rankTrendingHead([...rows].reverse(), now));
    expect(new Set(ranked.map((row) => row.id)).size).toBe(ranked.length);
    const head = ranked.slice(0, 24);
    expect(head.filter((row) => row.publishedAt === now).length).toBeGreaterThan(0);
    for (const author of new Set(head.map((row) => row.repoOwner))) expect(head.filter((row) => row.repoOwner === author).length).toBeLessThanOrEqual(2);
  });
  it('stops before issuing an over-budget queue write and records actual yield separately', async () => {
    const send = vi.fn();
    const counts = new Map<string, number>();
    const env = withDiscoveryQueueBudget({ INDEXING_QUEUE: { send } as never }, 1, counts);
    const message = { type: 'check_skill' as const, repoOwner: 'acme', repoName: 'demo', discoverySource: 'github-topics' as const };
    await env.INDEXING_QUEUE.send(message);
    await expect(env.INDEXING_QUEUE.send(message)).rejects.toThrow('budget exhausted');
    expect(send).toHaveBeenCalledTimes(1);
    const { db, sqlite } = createMigratedDb();
    await recordDiscoveryStats(db, 'github-topics', { queued: 1 });
    await recordDiscoveryStats(db, 'github-topics', { completed: 1, indexed: 0 });
    expect(sqlite.prepare('SELECT queued, completed, indexed FROM discovery_daily_stats').get()).toMatchObject({ queued: 1, completed: 1, indexed: 0 });
    sqlite.close();
  });
  it('backs off after three empty runs and recovers on effective additions', () => {
    let state;
    for (let i = 0; i < 3; i++) state = nextDiscoveryChannelState(state, { completed: 0, indexed: 0, queued: 0, failed: false }, 900000, 0);
    expect(state?.nextRunAt).toBe(1800000);
    const recovered = nextDiscoveryChannelState(state, { completed: 1, indexed: 1, queued: 0, failed: false }, 900000, 0);
    expect(recovered.nextRunAt).toBe(900000);
  });
});


describe('growth integration regressions', () => {
  it('keeps every tail item reachable after a short diverse trending first page', async () => {
    const { db, sqlite } = createMigratedDb();
    sqlite.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<50)
      INSERT INTO skills(id,name,slug,repo_owner,repo_name,skill_path,description)
      SELECT CAST(n AS TEXT),'Skill','acme/'||n,'acme','repo','skills/'||n,'A useful skill' FROM seq;`);
    sqlite.exec("UPDATE skills SET quality_status = 'eligible'");
    const pages = [];
    for (let page = 1; page <= 3; page++) pages.push(await getTrendingSkillsPaginated({ DB: db }, page, 24));
    expect(pages.map((page) => page.skills.length)).toEqual([2, 24, 24]);
    expect(pages.every((page) => page.total === 50 && page.totalPages === 3)).toBe(true);
    expect(new Set(pages.flatMap((page) => page.skills.map((skill) => skill.id))).size).toBe(50);
    sqlite.close();
  });
  it('keeps distinct continuation pages and pinned revisions during batch deduplication', () => {
    const root = { type: 'check_skill' as const, repoOwner: 'Acme', repoName: 'Demo', headSha: 'sha1' };
    const page = { ...root, discoveryPathOffset: 25 };
    const keys = [root, page, { ...root, discoveryPathOffset: 50 }, { ...page, headSha: 'sha2' }]
      .map(getMessageDedupKey);
    expect(new Set(keys).size).toBe(4);
    expect(getMessageDedupKey({ ...page, repoOwner: 'acme', repoName: 'demo' })).toBe(keys[1]);
  });
  it('keeps unready JSON-LD detail links English and does not rewrite other origins', () => {
    expect(localizeSeoUrl('https://skills.cat.evil/recent', 'zh-CN')).toBe('https://skills.cat.evil/recent');
    expect(localizeStructuredData({ url: 'https://skills.cat/skills/acme/one' }, 'zh-CN')).toEqual({ url: 'https://skills.cat/skills/acme/one' });
    expect(localizeStructuredData({ url: 'https://skills.cat/skills/acme/one' }, 'zh-CN', 'https://skills.cat/skills/acme/one')).toEqual({ url: 'https://skills.cat/zh-CN/skills/acme/one' });
  });
  it('shares a hard daily allowance across callers and refunds unused capacity', async () => {
    const { db, sqlite } = createMigratedDb();
    expect(await reserveDiscoveryAllowance(db, 8, 10)).toBe(8);
    expect(await reserveDiscoveryAllowance(db, 8, 10)).toBe(2);
    expect(await reserveDiscoveryAllowance(db, 8, 10)).toBe(0);
    await releaseDiscoveryAllowance(db, 3);
    expect(await reserveDiscoveryAllowance(db, 8, 10)).toBe(3);
    sqlite.close();
  });
  it('bounds nested fanout, pins continuation enumeration and stops without queue writes at the daily cap', async () => {
    const { db, sqlite } = createMigratedDb();
    const { kv } = createMemoryKv();
    const send = vi.fn();
    const env = { DB: db, KV: kv, INDEXING_QUEUE: { send }, DISCOVERY_MAX_QUEUED_PER_DAY: '28' } as never;
    const paths = Array.from({ length: 70 }, (_, i) => `skills/path-${i}`);
    const message = { type: 'check_skill' as const, repoOwner: 'acme', repoName: 'demo', discoverySource: 'github-topics' as const };
    expect(await queueDiscoveredSkillPaths(message, 'acme', 'demo', 'sha1', paths, env)).toBe(26);
    const continuation = send.mock.calls.at(-1)?.[0];
    expect(continuation).toMatchObject({ discoveryPathOffset: 25, headSha: 'sha1', gitRef: 'sha1' });
    expect(await queueDiscoveredSkillPaths(continuation, 'acme', 'demo', 'sha1', paths, env)).toBe(2);
    expect(send.mock.calls.at(-1)?.[0].discoveryPathOffset).toBe(26);
    await expect(queueDiscoveredSkillPaths(send.mock.calls.at(-1)?.[0], 'acme', 'demo', 'sha1', paths, env)).rejects.toThrow('budget exhausted');
    expect(send).toHaveBeenCalledTimes(28);
    expect(sqlite.prepare("SELECT queued FROM discovery_daily_stats WHERE source = 'github-topics'").get()).toMatchObject({ queued: 28 });
    sqlite.close();
  });
  it('retains cooldown when a failed precompute is marked dirty repeatedly', async () => {
    const { db, sqlite } = createMigratedDb();
    sqlite.exec("INSERT INTO skills(id,name,slug) VALUES('one','One','acme/one')");
    await markRecommendDirty(db, 'one', 100);
    await markSearchDirty(db, 'one', 100);
    sqlite.exec("UPDATE skill_recommend_state SET fail_count=2,next_update_at=10000; UPDATE skill_search_state SET fail_count=2,next_update_at=10000");
    await markRecommendDirty(db, 'one', 200);
    await markSearchDirty(db, 'one', 200);
    await markSearchDirtyBatch(db, ['one'], 300);
    for (const kind of ['recommend', 'search']) expect(sqlite.prepare(`SELECT next_update_at FROM skill_${kind}_state`).get()).toMatchObject({ next_update_at: 10000 });
    sqlite.close();
  });
  it('orders recent by first publication even when commits and refreshes are newer elsewhere', async () => {
    const { db, sqlite } = createMigratedDb();
    sqlite.exec(`INSERT INTO skills(id,name,slug,created_at,indexed_at,last_commit_at,description)
      VALUES('old','Old','acme/old',1,1000,9999,'Older skill'), ('new','New','acme/new',2,2,1,'Newly indexed skill');`);
    sqlite.exec("UPDATE skills SET quality_status = 'eligible'");
    expect((await getRecentSkills({ DB: db }, 2)).map((skill) => skill.id)).toEqual(['new', 'old']);
    sqlite.exec("UPDATE skills SET indexed_at=99999,updated_at=99999 WHERE id='old'");
    sqlite.exec("UPDATE skills SET quality_status = 'eligible'");
    expect((await getRecentSkills({ DB: db }, 2)).map((skill) => skill.id)).toEqual(['new', 'old']);
    sqlite.close();
  });
  it('keeps due scans indexed and bounded with 20000 states sharing a deadline', () => {
    const { sqlite } = createMigratedDb();
    sqlite.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<20000)
      INSERT INTO skills(id,name,slug) SELECT CAST(n AS TEXT),'Skill', 'acme/'||n FROM seq;
      INSERT INTO skill_search_state(skill_id,dirty,next_update_at) SELECT id,1,1000 FROM skills;`);
    const query = 'SELECT skill_id FROM skill_search_state INDEXED BY skill_search_state_due_idx WHERE next_update_at <= ? ORDER BY next_update_at, skill_id LIMIT 40';
    const plan = JSON.stringify(sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(2000));
    expect(plan).toContain('COVERING INDEX skill_search_state_due_idx');
    expect(plan).not.toContain('TEMP B-TREE');
    expect(sqlite.prepare(query).all(2000)).toHaveLength(40);
    sqlite.close();
  });
});


describe('idle and repair work budgets', () => {
  it('issues no external requests when the shared discovery allowance is exhausted', async () => {
    const { db, sqlite } = createMigratedDb();
    const { kv } = createMemoryKv();
    await reserveDiscoveryAllowance(db, 500, 500);
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      await githubEventsWorker.scheduled({} as never, { DB: db, KV: kv } as never, {} as never);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); sqlite.close(); }
  });
  it('walks missing state without rescanning the newest completed rows or bypassing failures', async () => {
    const { db, sqlite } = createMigratedDb();
    sqlite.exec(`INSERT INTO skills(id,name,slug) VALUES('one','One','acme/one'),('two','Two','acme/two'),('three','Three','acme/three');
      INSERT INTO skill_search_state(skill_id,dirty,next_update_at,fail_count) VALUES('three',1,999999,3);`);
    let stored: string | undefined;
    const put = vi.fn(async (_key: string, value: string) => { stored = value; });
    const env = { DB: db, R2: { get: async () => stored ? { json: async () => JSON.parse(stored!) } : null, put } } as never;
    await seedMissingPrecomputeState(env, 'search', 2, 1, 100);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM skill_search_state').get()).toMatchObject({ n: 2 });
    await seedMissingPrecomputeState(env, 'search', 2, 1, 200);
    expect(put).toHaveBeenCalledTimes(1);
    await seedMissingPrecomputeState(env, 'search', 2, 1, 86400200);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM skill_search_state').get()).toMatchObject({ n: 3 });
    expect(sqlite.prepare("SELECT next_update_at FROM skill_search_state WHERE skill_id='three'").get()).toMatchObject({next_update_at:999999});
    sqlite.close();
  });
});
