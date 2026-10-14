import type { DbEnv, SkillListRow } from '$lib/server/db/shared/types';
import type { SkillCardData } from '$lib/types';
import { addCategoriesToSkills, hydrateCachedSkills } from '$lib/server/db/shared/skills';
import { CACHE_VERSION_PATTERN, LIST_CACHE_MAX_AGE_MS } from '$lib/server/db/shared/constants';

export function getHomeSnapshotR2Key(cacheVersion?: string): string {
  const version = cacheVersion?.trim();
  return version && CACHE_VERSION_PATTERN.test(version)
    ? `cache/lists/${version}/home-snapshot-v1.json`
    : 'cache/home-snapshot-v1.json';
}
type SnapshotRow = Omit<SkillListRow, 'authorAvatar'> & { authorAvatar?: string | null };

interface HomeSnapshot {
  generatedAt: number;
  stats: { totalSkills: number };
  trending: SkillCardData[];
  recent: SkillCardData[];
  top: SkillCardData[];
}

/** Reuse the lists already selected by the trending worker, never scan again. */
export async function writeHomeSnapshot(
  env: DbEnv,
  input: {
    stats: { totalSkills: number };
    trending: SnapshotRow[];
    recent: SnapshotRow[];
    top: SnapshotRow[];
  },
  generatedAt = Date.now()
): Promise<void> {
  if (!env.R2 || !env.DB) return;
  const lists = [input.trending.slice(0, 12), input.recent.slice(0, 12), input.top.slice(0, 12)];
  const unique = [...new Map(lists.flat().map((row) => [row.id, { ...row, authorAvatar: row.authorAvatar ?? null }])).values()];
  const cards = new Map((await addCategoriesToSkills(env.DB, unique)).map((card) => [card.id, card]));
  const [trending, recent, top] = lists.map((rows) => rows.map((row) => cards.get(row.id)!));
  await storeHomeSnapshot(env.R2, { generatedAt, stats: input.stats, trending, recent, top }, env.CACHE_VERSION);
}

export async function storeHomeSnapshot(r2: R2Bucket, snapshot: HomeSnapshot, cacheVersion?: string): Promise<void> {
  await r2.put(getHomeSnapshotR2Key(cacheVersion), JSON.stringify(snapshot), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/** One R2 read and one bounded hydration replace three independent list chains. */
export async function readHomeSnapshot(env: DbEnv): Promise<HomeSnapshot | null> {
  if (!env.R2 || !env.DB) return null;
  try {
    const object = await env.R2.get(getHomeSnapshotR2Key(env.CACHE_VERSION));
    if (!object) return null;
    const snapshot = await object.json<HomeSnapshot>();
    const age = Date.now() - snapshot.generatedAt;
    if (!Number.isFinite(age) || age < 0 || age > LIST_CACHE_MAX_AGE_MS
      || !Number.isFinite(snapshot.stats?.totalSkills) || snapshot.stats.totalSkills < 0) return null;
    const lists = [snapshot.trending, snapshot.recent, snapshot.top];
    if (lists.some((rows) => !Array.isArray(rows) || rows.length > 12
      || rows.some((row) => !row || typeof row.id !== 'string' || typeof row.slug !== 'string'))) return null;
    const unique = [...new Map(lists.flat().map((row) => [row.id, row])).values()];
    // Recheck current visibility/quality and metadata even when the snapshot is fresh.
    const current = await hydrateCachedSkills(env.DB, unique, true);
    if (current.length !== unique.length) return null;
    const byId = new Map(current.map((row) => [row.id, row]));
    const [trending, recent, top] = lists.map((rows) => rows.map((row) => byId.get(row.id)!));
    return { ...snapshot, trending, recent, top };
  } catch {
    return null;
  }
}
