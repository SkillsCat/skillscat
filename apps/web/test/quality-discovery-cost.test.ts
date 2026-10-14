import { afterEach, describe, expect, it } from 'vitest';
import { filterQualityEligibleSkills } from '../src/lib/server/skill/quality-discovery';
import { createMigratedDb } from './helpers/migrated-db';

const databases: ReturnType<typeof createMigratedDb>[] = [];

function fixture(count: number) {
  const context = createMigratedDb();
  databases.push(context);
  // Include every production index so a competing quality/ranking index can
  // reproduce the planner regression, rather than testing an idealized schema.
  context.sqlite.exec(`
    WITH RECURSIVE numbers(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ${count}
    )
    INSERT INTO skills(id, name, slug, visibility, quality_status)
    SELECT 'skill-' || n, 'Skill ' || n, 'owner/skill-' || n, 'public', 'eligible'
    FROM numbers;
  `);
  return context;
}

afterEach(() => {
  databases.splice(0).forEach(({ sqlite }) => sqlite.close());
});

describe('recommendation quality lookup read cost', () => {
  it.each([false, true])('seeks each requested ID with all migrations applied (ANALYZE=%s)', async (analyze) => {
    const { sqlite, db, queries } = fixture(10_000);
    if (analyze) sqlite.exec('ANALYZE');
    // Also cover payloads larger than D1's bind limit: JSON remains one bind.
    const input = Array.from({ length: 120 }, (_, index) => ({ id: `skill-${index + 1}` }));
    expect(await filterQualityEligibleSkills(db, input)).toEqual(input);
    expect(queries).toHaveLength(1);
    const { sql, params } = queries[0];
    expect(params).toHaveLength(1);
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
    const skillAccess = plan.filter(({ detail }) => /(?:SEARCH|SCAN) skills\b/.test(detail));
    // Merely asserting "SEARCH" is insufficient: quality_status=? still reads
    // every eligible skill. Both visibility AND id must constrain the seek.
    expect(skillAccess).toHaveLength(1);
    expect(skillAccess[0].detail).toContain('USING INDEX skills_visibility_id_idx (visibility=? AND id=?)');
  });

  it('preserves order, duplicates and card data while excluding non-public, ineligible and deleted skills', async () => {
    const { sqlite, db, queries } = fixture(6);
    sqlite.exec(`
      UPDATE skills SET visibility = 'private' WHERE id = 'skill-3';
      UPDATE skills SET visibility = 'unlisted' WHERE id = 'skill-4';
      UPDATE skills SET quality_status = 'pending' WHERE id = 'skill-5';
      UPDATE skills SET quality_status = 'low_quality' WHERE id = 'skill-6';
    `);
    const input = [2, 3, 1, 4, 5, 6, 999, 2].map((id, rank) => ({ id: `skill-${id}`, rank }));
    expect(await filterQualityEligibleSkills(db, input)).toEqual([input[0], input[2], input[7]]);
    expect(queries).toHaveLength(1);
    expect(JSON.parse(queries[0].params[0] as string)).toHaveLength(7);
  });

  it('does not query for empty input or serve unchecked cards without a database', async () => {
    const { db, queries } = fixture(1);
    expect(await filterQualityEligibleSkills(db, [])).toEqual([]);
    expect(await filterQualityEligibleSkills(undefined, [{ id: 'skill-1' }])).toEqual([]);
    expect(queries).toEqual([]);
  });
});
