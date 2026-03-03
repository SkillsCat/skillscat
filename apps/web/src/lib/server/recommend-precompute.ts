export type RecommendSkillTier = 'hot' | 'warm' | 'cool' | 'cold' | 'archived';

export interface RecommendSkillPayloadItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repoOwner: string;
  repoName: string;
  stars: number;
  forks: number;
  trendingScore: number;
  updatedAt: number;
  authorAvatar?: string | null;
  categories?: string[];
}

export interface RecommendPrecomputedPayload {
  version: 'v1';
  algoVersion: string;
  skillId: string;
  computedAt: number;
  recommendSkills: RecommendSkillPayloadItem[];
}

export interface RecommendStateRow {
  skill_id: string;
  dirty: number;
  next_update_at: number | null;
  precomputed_at: number | null;
  algo_version: string | null;
  fail_count: number | null;
  last_error_at: number | null;
  last_fallback_at: number | null;
  created_at: number;
  updated_at: number;
}

export const DEFAULT_RECOMMEND_ALGO_VERSION = 'v1';
const RECOMMEND_PRECOMPUTE_R2_PREFIX = 'cache/recommend';

const CACHE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export function normalizeRecommendAlgoVersion(value: string | undefined | null): string {
  const normalized = (value || '').trim();
  if (!normalized) return DEFAULT_RECOMMEND_ALGO_VERSION;
  return CACHE_VERSION_PATTERN.test(normalized) ? normalized : DEFAULT_RECOMMEND_ALGO_VERSION;
}

export function buildRecommendPrecomputeR2Key(skillId: string, algoVersion: string): string {
  return `${RECOMMEND_PRECOMPUTE_R2_PREFIX}/${algoVersion}/${skillId}.json`;
}

export function getNextRecommendUpdateAt(
  tier: string | null | undefined,
  now: number = Date.now()
): number | null {
  switch (tier) {
    case 'hot':
      return now + 6 * 60 * 60 * 1000;
    case 'warm':
      return now + 48 * 60 * 60 * 1000;
    case 'cool':
      return now + 14 * 24 * 60 * 60 * 1000;
    case 'cold':
    case 'archived':
    default:
      return null;
  }
}

function isRecommendSkillPayloadItem(value: unknown): value is RecommendSkillPayloadItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.slug === 'string'
    && typeof item.repoOwner === 'string'
    && typeof item.repoName === 'string';
}

export function isRecommendPrecomputedPayload(value: unknown): value is RecommendPrecomputedPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.version === 'v1'
    && typeof payload.algoVersion === 'string'
    && typeof payload.skillId === 'string'
    && typeof payload.computedAt === 'number'
    && Array.isArray(payload.recommendSkills)
    && payload.recommendSkills.every(isRecommendSkillPayloadItem);
}

export async function readRecommendPrecomputedPayload(
  r2: R2Bucket | undefined,
  skillId: string,
  algoVersion: string
): Promise<RecommendPrecomputedPayload | null> {
  if (!r2) return null;
  const object = await r2.get(buildRecommendPrecomputeR2Key(skillId, algoVersion));
  if (!object) return null;

  try {
    const json = await object.json<unknown>();
    return isRecommendPrecomputedPayload(json) ? json : null;
  } catch {
    return null;
  }
}

export async function writeRecommendPrecomputedPayload(
  r2: R2Bucket | undefined,
  payload: RecommendPrecomputedPayload
): Promise<void> {
  if (!r2) return;
  await r2.put(
    buildRecommendPrecomputeR2Key(payload.skillId, payload.algoVersion),
    JSON.stringify(payload),
    { httpMetadata: { contentType: 'application/json' } }
  );
}

export async function markRecommendDirty(
  db: D1Database | undefined,
  skillId: string,
  now: number = Date.now()
): Promise<void> {
  if (!db) return;
  await db.prepare(`
    INSERT INTO skill_recommend_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version,
      fail_count, last_error_at, last_fallback_at, created_at, updated_at
    )
    VALUES (?, 1, ?, NULL, NULL, 0, NULL, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 1,
      next_update_at = excluded.next_update_at,
      updated_at = excluded.updated_at
  `)
    .bind(skillId, now, now, now)
    .run();
}

export async function upsertRecommendStateSuccess(
  db: D1Database | undefined,
  params: {
    skillId: string;
    tier: string | null | undefined;
    algoVersion: string;
    now?: number;
  }
): Promise<void> {
  if (!db) return;
  const now = params.now ?? Date.now();
  const nextUpdateAt = getNextRecommendUpdateAt(params.tier, now);
  await db.prepare(`
    INSERT INTO skill_recommend_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version,
      fail_count, last_error_at, last_fallback_at, created_at, updated_at
    )
    VALUES (?, 0, ?, ?, ?, 0, NULL, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 0,
      next_update_at = excluded.next_update_at,
      precomputed_at = excluded.precomputed_at,
      algo_version = excluded.algo_version,
      fail_count = 0,
      last_error_at = NULL,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, nextUpdateAt, now, params.algoVersion, now, now)
    .run();
}

export async function upsertRecommendStateFailure(
  db: D1Database | undefined,
  params: {
    skillId: string;
    now?: number;
    retryAfterMs?: number;
  }
): Promise<void> {
  if (!db) return;
  const now = params.now ?? Date.now();
  const nextUpdateAt = now + (params.retryAfterMs ?? 60 * 60 * 1000);
  await db.prepare(`
    INSERT INTO skill_recommend_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version,
      fail_count, last_error_at, last_fallback_at, created_at, updated_at
    )
    VALUES (?, 1, ?, NULL, NULL, 1, ?, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 1,
      next_update_at = excluded.next_update_at,
      fail_count = COALESCE(skill_recommend_state.fail_count, 0) + 1,
      last_error_at = excluded.last_error_at,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, nextUpdateAt, now, now, now)
    .run();
}

export async function updateRecommendStateNextUpdateAt(
  db: D1Database | undefined,
  params: {
    skillId: string;
    tier: string | null | undefined;
    now?: number;
  }
): Promise<void> {
  if (!db) return;
  const now = params.now ?? Date.now();
  const nextUpdateAt = getNextRecommendUpdateAt(params.tier, now);
  await db.prepare(`
    INSERT INTO skill_recommend_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version,
      fail_count, last_error_at, last_fallback_at, created_at, updated_at
    )
    VALUES (?, 0, ?, NULL, NULL, 0, NULL, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      next_update_at = excluded.next_update_at,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, nextUpdateAt, now, now)
    .run();
}

export async function markRecommendFallbackServed(
  db: D1Database | undefined,
  skillId: string,
  now: number = Date.now()
): Promise<void> {
  if (!db) return;
  await db.prepare(`
    INSERT INTO skill_recommend_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version,
      fail_count, last_error_at, last_fallback_at, created_at, updated_at
    )
    VALUES (?, 1, ?, NULL, NULL, 0, NULL, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      last_fallback_at = excluded.last_fallback_at,
      updated_at = excluded.updated_at
  `)
    .bind(skillId, now, now, now, now)
    .run();
}
