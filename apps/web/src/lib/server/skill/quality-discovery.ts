import { getCached } from '$lib/server/cache';

export const QUALITY_DISCOVERY_COUNT_KEY = 'cache/lists/discovery-count-v1.json';
export async function countQualityEligibleSkills(db: D1Database): Promise<number> {
  // Public list browsing is capped at 100 pages of 24 items.
  const row = await db.prepare(`
    SELECT COUNT(*) AS total FROM (
      SELECT id FROM skills INDEXED BY skills_discovery_trending_idx
      WHERE visibility = 'public' AND quality_status = 'eligible' LIMIT 2400
    )
  `).first<{ total: number }>();
  return row?.total ?? 0;
}

/** Recheck old R2/edge recommendation payloads with one bounded, cached PK lookup. */
export async function filterQualityEligibleSkills<T extends { id: string }>(
  db: D1Database | undefined, skills: T[]
): Promise<T[]> {
  if (!db || !skills.length) return [];
  const ids = [...new Set(skills.map((skill) => skill.id))].sort();
  const serialized = JSON.stringify(ids);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  const key = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const { data } = await getCached(`quality:eligible:v1:${key}`, async () => {
    const rows = await db.prepare(`
      SELECT id FROM skills
      WHERE id IN (SELECT value FROM json_each(?))
        AND visibility = 'public' AND quality_status = 'eligible'
    `).bind(serialized).all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }, 60);
  const eligible = new Set(data);
  return skills.filter((skill) => eligible.has(skill.id));
}
