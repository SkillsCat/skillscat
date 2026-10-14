import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { loadPendingSkills, tryClaimVirusTotalWork, VT_CANDIDATE_WINDOW } from '../workers/virustotal';
import { createMemoryKv, createMigratedDb } from './helpers/migrated-db';

const databases: ReturnType<typeof createMigratedDb>[] = [];
function fixture(count = 1) {
  const context = createMigratedDb();
  databases.push(context);
  context.sqlite.exec(`
    WITH RECURSIVE numbers(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ${count}
    )
    INSERT INTO skills(id, name, slug, visibility, stars)
    SELECT printf('skill-%06d', n), 'Skill ' || n, 'owner/skill-' || n, 'public', 0 FROM numbers;
    INSERT INTO skill_security_state(skill_id, vt_eligibility, vt_status, vt_priority, vt_next_attempt_at, updated_at)
    SELECT id, 'eligible', 'pending_lookup', 100, 100, 100 FROM skills;
  `);
  return context;
}

afterEach(() => {
  databases.splice(0).forEach(({ sqlite }) => sqlite.close());
  vi.unstubAllGlobals();
});

describe('VirusTotal bounded queue reads', () => {
  it.each([false, true])('bounds candidate selection and ID hydration with a large backlog (ANALYZE=%s)', async (analyze) => {
    const { sqlite, db, queries } = fixture(10_000);
    if (analyze) sqlite.exec('ANALYZE');
    expect(await loadPendingSkills(db as never, 100)).toHaveLength(10);
    expect(queries).toHaveLength(4);
    const candidateQuery = queries[0];
    expect(sqlite.prepare(candidateQuery.sql).all(...candidateQuery.params)).toHaveLength(VT_CANDIDATE_WINDOW);
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${candidateQuery.sql}`).all(...candidateQuery.params);
    expect(JSON.stringify(plan)).toContain('skill_security_state_vt_queue_due_idx (<expr><?)');
    expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');
    expect(JSON.stringify(plan)).not.toContain('SCAN skill_security_state');
    const priorityQuery = queries[1];
    expect(sqlite.prepare(priorityQuery.sql).all()).toHaveLength(VT_CANDIDATE_WINDOW);
    const priorityPlan = JSON.stringify(sqlite.prepare(`EXPLAIN QUERY PLAN ${priorityQuery.sql}`).all());
    expect(priorityPlan).toContain('skill_security_state_vt_queue_priority_idx');
    expect(priorityPlan).not.toContain('TEMP B-TREE');
    for (const query of queries.slice(2)) {
      const details = JSON.stringify(sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params));
      expect(details).toContain('skills_visibility_id_idx (visibility=? AND id=?)');
      expect(details).not.toMatch(/SCAN (s|ss|skills)\b/);
    }
    expect(queries[2].sql).not.toContain('readme');
    expect(JSON.parse(queries[2].params[0] as string)).toHaveLength(VT_CANDIDATE_WINDOW);
    expect(JSON.parse(queries[3].params[0] as string)).toHaveLength(10);
  });

  it('admits newly urgent work beyond the oldest window with at most 128 distinct candidates', async () => {
    const { sqlite, db, queries } = fixture(200);
    sqlite.exec(`UPDATE skill_security_state SET vt_priority = 900, vt_next_attempt_at = 150
      WHERE skill_id > 'skill-000136'`);
    const rows = await loadPendingSkills(db as never, 200);
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.vt_priority === 900)).toBe(true);
    expect(JSON.parse(queries[2].params[0] as string)).toHaveLength(2 * VT_CANDIDATE_WINDOW);
  });

  it('does not let a future high-priority window block older due work', async () => {
    const { sqlite, db } = fixture(200);
    sqlite.exec(`UPDATE skill_security_state SET vt_priority = 900, vt_next_attempt_at = 500
      WHERE skill_id > 'skill-000100'`);
    const rows = await loadPendingSkills(db as never, 200);
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.vt_priority === 100)).toBe(true);
  });

  it('excludes completed, ineligible and future work while accepting NULL and exactly-due times', async () => {
    const { sqlite, db } = fixture(7);
    sqlite.exec(`
      UPDATE skill_security_state SET vt_next_attempt_at = NULL WHERE skill_id = 'skill-000001';
      UPDATE skill_security_state SET vt_next_attempt_at = 101 WHERE skill_id = 'skill-000002';
      UPDATE skill_security_state SET vt_status = 'completed' WHERE skill_id = 'skill-000003';
      UPDATE skill_security_state SET vt_eligibility = 'deferred_low_priority' WHERE skill_id = 'skill-000004';
      UPDATE skill_security_state SET vt_status = 'pending_upload' WHERE skill_id = 'skill-000005';
      UPDATE skill_security_state SET vt_status = 'pending_analysis_poll' WHERE skill_id = 'skill-000006';
    `);
    expect((await loadPendingSkills(db as never, 100)).map((row) => row.id))
      .toEqual(['skill-000001', 'skill-000005', 'skill-000006', 'skill-000007']);
  });

  it('preserves priority, report, star and age ordering within the due window', async () => {
    const { sqlite, db } = fixture(5);
    sqlite.exec(`
      UPDATE skill_security_state SET vt_priority = 200 WHERE skill_id = 'skill-000005';
      UPDATE skill_security_state SET open_security_report_count = 2 WHERE skill_id = 'skill-000004';
      UPDATE skills SET stars = 50 WHERE id = 'skill-000003';
      UPDATE skill_security_state SET updated_at = 50 WHERE skill_id = 'skill-000002';
    `);
    expect((await loadPendingSkills(db as never, 100)).map((row) => row.id))
      .toEqual(['skill-000005', 'skill-000004', 'skill-000003', 'skill-000002', 'skill-000001']);
  });

  it('removes a stale private/unlisted window from the queue so later public work progresses', async () => {
    const { sqlite, db, queries } = fixture(VT_CANDIDATE_WINDOW + 1);
    sqlite.exec(`UPDATE skills SET visibility = CASE WHEN id < 'skill-000032' THEN 'private' ELSE 'unlisted' END
      WHERE id <= 'skill-000064'`);
    expect(await loadPendingSkills(db as never, 100)).toEqual([]);
    const cleanup = queries.find(({ sql }) => sql.includes('UPDATE skill_security_state'))!;
    const plan = JSON.stringify(sqlite.prepare(`EXPLAIN QUERY PLAN ${cleanup.sql}`).all(...cleanup.params));
    expect(plan).toContain('sqlite_autoindex_skill_security_state_1 (skill_id=?)');
    expect(plan).toContain('skills_visibility_id_idx (visibility=? AND id=?)');
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM skill_security_state WHERE vt_eligibility = 'skipped_visibility'").get())
      .toMatchObject({ n: VT_CANDIDATE_WINDOW });
    expect((await loadPendingSkills(db as never, 100)).map((row) => row.id)).toEqual(['skill-000065']);
  });

  it('advances through the backlog as claimed entries are leased, and skips future-only queues', async () => {
    const { sqlite, db, queries } = fixture(VT_CANDIDATE_WINDOW + 1);
    const first = await loadPendingSkills(db as never, 100);
    for (const row of first) {
      expect(await tryClaimVirusTotalWork(db as never, { skillId: row.id, status: row.vt_status, now: 100 })).toBe(true);
    }
    const next = await loadPendingSkills(db as never, 100);
    expect(next).toHaveLength(10);
    expect(next.some((row) => first.some((claimed) => claimed.id === row.id))).toBe(false);
    sqlite.exec('UPDATE skill_security_state SET vt_next_attempt_at = 1000');
    queries.length = 0;
    expect(await loadPendingSkills(db as never, 100)).toEqual([]);
    expect(queries).toHaveLength(1);
  });

  it('stops claiming rows as soon as processing consumes the remaining API budget', async () => {
    const { sqlite, db, queries } = fixture(12);
    sqlite.exec("UPDATE skill_security_state SET vt_bundle_sha256 = 'cached-sha'");
    const fetch = vi.fn(async () => Response.json({ data: { attributes: { last_analysis_stats: { harmless: 1 } } } }));
    vi.stubGlobal('fetch', fetch);
    await worker.scheduled({} as never, {
      DB: db, KV: createMemoryKv().kv, VIRUSTOTAL_API_KEY: 'test-only',
      VT_DAILY_REQUEST_BUDGET: '1', VT_MINUTE_REQUEST_BUDGET: '1',
    } as never, {} as never);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queries.filter(({ sql }) => sql.includes('SET vt_next_attempt_at = ?'))).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM skill_security_state WHERE vt_status = 'completed'").get()).toMatchObject({ n: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM skill_security_state WHERE vt_next_attempt_at = 100').get()).toMatchObject({ n: 11 });
  });
});
