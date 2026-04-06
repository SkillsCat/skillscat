import type { D1Database } from '@cloudflare/workers-types';
import { getCached } from '$lib/server/cache';
import type { SkillCardData } from '$lib/types';
import {
  normalizeRecommendAlgoVersion,
  readRecommendPrecomputedPayload,
  type RecommendPrecomputedPayload,
  type RecommendSkillPayloadItem,
} from '$lib/server/ranking/recommend-precompute';

type WaitUntilFn = (promise: Promise<unknown>) => void;

export const RECOMMEND_ONLINE_CACHE_TTL_SECONDS = 12 * 60 * 60;
export const RECOMMEND_PRECOMPUTED_READ_CACHE_TTL_SECONDS = 6 * 60 * 60;

export interface RecommendRefreshStateRow {
  recommendDirty: number | null;
  recommendNextUpdateAt: number | null;
  recommendPrecomputedAt: number | null;
  recommendAlgoVersion: string | null;
}

export function buildRecommendPrecomputedCacheKey(skillId: string, algoVersion: string): string {
  return `recommend:precomputed:${skillId}:${algoVersion}`;
}

function mapRecommendPayloadItem(item: RecommendSkillPayloadItem): SkillCardData {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    repoOwner: item.repoOwner,
    repoName: item.repoName,
    stars: item.stars,
    forks: item.forks,
    trendingScore: item.trendingScore,
    updatedAt: item.updatedAt,
    categories: item.categories ?? [],
    authorAvatar: item.authorAvatar ?? undefined,
  };
}

export function mapRecommendPayloadItems(
  items: RecommendSkillPayloadItem[],
  limit: number = items.length
): SkillCardData[] {
  return items
    .slice(0, limit)
    .map(mapRecommendPayloadItem);
}

export async function readCachedRecommendPrecomputedPayload(input: {
  skillId: string;
  r2?: R2Bucket;
  algoVersion?: string | null;
  waitUntil?: WaitUntilFn;
}): Promise<{
  payload: RecommendPrecomputedPayload | null;
  hit: boolean;
  algoVersion: string;
}> {
  const algoVersion = normalizeRecommendAlgoVersion(input.algoVersion);
  const { data, hit } = await getCached(
    buildRecommendPrecomputedCacheKey(input.skillId, algoVersion),
    () => readRecommendPrecomputedPayload(input.r2, input.skillId, algoVersion),
    RECOMMEND_PRECOMPUTED_READ_CACHE_TTL_SECONDS,
    { waitUntil: input.waitUntil }
  );

  return {
    payload: data,
    hit,
    algoVersion,
  };
}

export async function readCachedRecommendSkills(input: {
  skillId: string;
  r2?: R2Bucket;
  algoVersion?: string | null;
  waitUntil?: WaitUntilFn;
  limit?: number;
}): Promise<{
  recommendSkills: SkillCardData[] | null;
  hit: boolean;
  algoVersion: string;
}> {
  const { payload, hit, algoVersion } = await readCachedRecommendPrecomputedPayload(input);

  return {
    recommendSkills: payload ? mapRecommendPayloadItems(payload.recommendSkills, input.limit) : null,
    hit,
    algoVersion,
  };
}

export function shouldRefreshPrecomputedRecommend(
  state: RecommendRefreshStateRow | null | undefined,
  algoVersion: string,
  now: number = Date.now()
): boolean {
  if (!state) return true;
  if ((state.recommendDirty ?? 0) === 1) return true;
  if (state.recommendAlgoVersion && state.recommendAlgoVersion !== algoVersion) return true;
  if (state.recommendNextUpdateAt !== null && state.recommendNextUpdateAt <= now) return true;

  const hasState = state.recommendDirty !== null
    || state.recommendNextUpdateAt !== null
    || state.recommendPrecomputedAt !== null
    || state.recommendAlgoVersion !== null;

  return !hasState;
}

export async function readRecommendRefreshState(
  db: D1Database | undefined,
  skillId: string
): Promise<RecommendRefreshStateRow | null> {
  if (!db) return null;

  return db.prepare(`
    SELECT
      dirty as recommendDirty,
      next_update_at as recommendNextUpdateAt,
      precomputed_at as recommendPrecomputedAt,
      algo_version as recommendAlgoVersion
    FROM skill_recommend_state
    WHERE skill_id = ?
    LIMIT 1
  `)
    .bind(skillId)
    .first<RecommendRefreshStateRow>();
}
