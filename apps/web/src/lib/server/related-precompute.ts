export type RelatedSkillTier = 'hot' | 'warm' | 'cool' | 'cold' | 'archived';

export interface RelatedSkillPayloadItem {
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

export interface RelatedPrecomputedPayload {
  version: 'v1';
  algoVersion: string;
  skillId: string;
  computedAt: number;
  relatedSkills: RelatedSkillPayloadItem[];
}

export interface RelatedStateRow {
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

export const DEFAULT_RELATED_ALGO_VERSION = 'v1';
const RELATED_PRECOMPUTE_R2_PREFIX = 'cache/related';

const CACHE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export function normalizeRelatedAlgoVersion(value: string | undefined | null): string {
  const normalized = (value || '').trim();
  if (!normalized) return DEFAULT_RELATED_ALGO_VERSION;
  return CACHE_VERSION_PATTERN.test(normalized) ? normalized : DEFAULT_RELATED_ALGO_VERSION;
}

export function buildRelatedPrecomputeR2Key(skillId: string, algoVersion: string): string {
  return `${RELATED_PRECOMPUTE_R2_PREFIX}/${algoVersion}/${skillId}.json`;
}

export function getNextRelatedUpdateAt(
  tier: string | null | undefined,
  now: number = Date.now()
): number | null {
  switch (tier) {
    case 'hot':
      return now + 6 * 60 * 60 * 1000;
    case 'warm':
      return now + 24 * 60 * 60 * 1000;
    case 'cool':
      return now + 7 * 24 * 60 * 60 * 1000;
    case 'cold':
    case 'archived':
    default:
      return null;
  }
}

function isRelatedSkillPayloadItem(value: unknown): value is RelatedSkillPayloadItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.slug === 'string'
    && typeof item.repoOwner === 'string'
    && typeof item.repoName === 'string';
}

export function isRelatedPrecomputedPayload(value: unknown): value is RelatedPrecomputedPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.version === 'v1'
    && typeof payload.algoVersion === 'string'
    && typeof payload.skillId === 'string'
    && typeof payload.computedAt === 'number'
    && Array.isArray(payload.relatedSkills)
    && payload.relatedSkills.every(isRelatedSkillPayloadItem);
}

export async function readRelatedPrecomputedPayload(
  r2: R2Bucket | undefined,
  skillId: string,
  algoVersion: string
): Promise<RelatedPrecomputedPayload | null> {
  if (!r2) return null;
  const object = await r2.get(buildRelatedPrecomputeR2Key(skillId, algoVersion));
  if (!object) return null;

  try {
    const json = await object.json<unknown>();
    return isRelatedPrecomputedPayload(json) ? json : null;
  } catch {
    return null;
  }
}

export async function writeRelatedPrecomputedPayload(
  r2: R2Bucket | undefined,
  payload: RelatedPrecomputedPayload
): Promise<void> {
  if (!r2) return;
  await r2.put(
    buildRelatedPrecomputeR2Key(payload.skillId, payload.algoVersion),
    JSON.stringify(payload),
    { httpMetadata: { contentType: 'application/json' } }
  );
}

export async function markRelatedDirty(
  db: D1Database | undefined,
  skillId: string,
  now: number = Date.now()
): Promise<void> {
  if (!db) return;
  await db.prepare(`
    INSERT INTO skill_related_state (
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

export async function upsertRelatedStateSuccess(
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
  const nextUpdateAt = getNextRelatedUpdateAt(params.tier, now);
  await db.prepare(`
    INSERT INTO skill_related_state (
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

export async function upsertRelatedStateFailure(
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
    INSERT INTO skill_related_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version,
      fail_count, last_error_at, last_fallback_at, created_at, updated_at
    )
    VALUES (?, 1, ?, NULL, NULL, 1, ?, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 1,
      next_update_at = excluded.next_update_at,
      fail_count = COALESCE(skill_related_state.fail_count, 0) + 1,
      last_error_at = excluded.last_error_at,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, nextUpdateAt, now, now, now)
    .run();
}

export async function updateRelatedStateNextUpdateAt(
  db: D1Database | undefined,
  params: {
    skillId: string;
    tier: string | null | undefined;
    now?: number;
  }
): Promise<void> {
  if (!db) return;
  const now = params.now ?? Date.now();
  const nextUpdateAt = getNextRelatedUpdateAt(params.tier, now);
  await db.prepare(`
    INSERT INTO skill_related_state (
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

export async function markRelatedFallbackServed(
  db: D1Database | undefined,
  skillId: string,
  now: number = Date.now()
): Promise<void> {
  if (!db) return;
  await db.prepare(`
    INSERT INTO skill_related_state (
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

