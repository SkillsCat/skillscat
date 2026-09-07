import { firstPublishedSql } from '$lib/server/seo/freshness';
import { getCached } from '$lib/server/cache';
import type { DbEnv, SkillListRow } from '$lib/server/db/shared/types';
import { diversify } from './diversity';

export const TRENDING_SNAPSHOT_KEY = 'cache/lists/trending-v2.json';
export const TRENDING_HEAD_SIZE = 240;
interface TrendingCandidate extends SkillListRow { publishedAt: number }
export interface TrendingSnapshot { version: 'v2'; generatedAt: number; data: TrendingCandidate[] }

export function rankTrendingHead(rows: TrendingCandidate[], now: number): TrendingCandidate[] {
  const sorted = [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort((a, b) => b.trendingScore - a.trendingScore || a.id.localeCompare(b.id));
  const fresh = sorted.filter((row) => row.publishedAt >= now - 14 * 86400000);
  const freshHead = diversify(fresh, 5, 4);
  const front = diversify([...freshHead, ...sorted], 24, 4);
  // Interleave discovery picks rather than putting all of them above momentum.
  const freshIds = new Set(freshHead.map((row) => row.id));
  const regular = front.filter((row) => !freshIds.has(row.id));
  const first: TrendingCandidate[] = [];
  while (regular.length || freshHead.length) {
    first.push(...regular.splice(0, 4), ...freshHead.splice(0, 1));
  }
  const frontIds = new Set(first.map((row) => row.id));
  // Keep a short head when the pool cannot meet the first-screen caps.
  return first.length < 24 ? first : [...first, ...sorted.filter((row) => !frontIds.has(row.id))].slice(0, TRENDING_HEAD_SIZE);
}

export async function buildTrendingSnapshot(db: D1Database, now = Date.now()): Promise<TrendingSnapshot> {
  const rows = await db.prepare(`
    WITH ranked AS MATERIALIZED (
      SELECT id FROM skills INDEXED BY skills_public_trending_id_idx
      WHERE visibility = 'public' ORDER BY trending_score DESC, id LIMIT 240
    ), recent AS MATERIALIZED (
      SELECT id FROM skills INDEXED BY skills_public_first_published_idx
      WHERE visibility = 'public' AND (${firstPublishedSql()}) >= ?
      ORDER BY (${firstPublishedSql()}) DESC, id LIMIT 48
    ), candidates AS (SELECT id FROM ranked UNION SELECT id FROM recent)
    SELECT s.id, s.name, s.slug, s.description, s.repo_owner AS repoOwner, s.repo_name AS repoName,
      s.stars, s.forks, s.trending_score AS trendingScore,
      COALESCE(s.last_commit_at, s.updated_at) AS updatedAt,
      (${firstPublishedSql('s')}) AS publishedAt,
      NULL AS authorAvatar
    FROM candidates c JOIN skills s ON s.id = c.id
    WHERE COALESCE(s.tier, 'cold') <> 'archived'
      AND COALESCE(s.origin_relation_type, '') <> 'historical_copy_of'
      AND (TRIM(COALESCE(s.description, '')) <> '' OR s.readme IS NOT NULL)
  `).bind(now - 14 * 86400000).all<TrendingCandidate>();
  return { version: 'v2', generatedAt: now, data: rankTrendingHead(rows.results || [], now) };
}

export async function loadTrendingSnapshot(env: DbEnv): Promise<TrendingSnapshot> {
  return (await getCached('lists:trending:snapshot:v2', async () => {
    if (env.R2) {
      const object = await env.R2.get(TRENDING_SNAPSHOT_KEY);
      if (object) {
        const snapshot = await object.json<TrendingSnapshot>();
        if (snapshot.version === 'v2' && Array.isArray(snapshot.data)) return snapshot;
      }
    }
    return env.DB ? buildTrendingSnapshot(env.DB) : { version: 'v2' as const, generatedAt: Date.now(), data: [] };
  }, 300)).data;
}
