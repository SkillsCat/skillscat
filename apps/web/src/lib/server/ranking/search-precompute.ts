import { getTopRatedSortScore } from '$lib/server/ranking';

export type SearchSkillTier = 'hot' | 'warm' | 'cool' | 'cold' | 'archived';

export interface SearchScoreInput {
  stars: number | null | undefined;
  trendingScore: number | null | undefined;
  downloadCount30d: number | null | undefined;
  downloadCount90d: number | null | undefined;
  accessCount30d: number | null | undefined;
  lastCommitAt: number | null | undefined;
  updatedAt: number | null | undefined;
  tier?: string | null | undefined;
}

export interface SearchStateRow {
  skill_id: string;
  dirty: number;
  next_update_at: number | null;
  precomputed_at: number | null;
  algo_version: string | null;
  score: number | null;
  fail_count: number | null;
  last_error_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SearchTermEntry {
  term: string;
  weight: number;
  source: string;
}

export interface SearchTermsDocument {
  name?: string | null;
  slug?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  description?: string | null;
  categories?: string[] | null;
  tags?: string[] | null;
}

export const DEFAULT_SEARCH_ALGO_VERSION = 'v1';
const CACHE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const SEARCH_STATE_BATCH_SIZE = 100;
const MAX_TERMS_PER_SKILL = 96;
const TOKEN_SPLIT_REGEX = /[^\p{L}\p{N}]+/u;
const MAX_TERM_LENGTH = 48;
const MIN_TERM_LENGTH = 2;
const DEFAULT_SOURCE = 'token';
const SOURCE_WEIGHTS: Record<string, number> = {
  name: 9,
  slug: 7,
  repo: 6,
  category: 8,
  tag: 7,
  description: 2,
};

function toNonNegative(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function getRecencyBoostDays(daysSinceActivity: number): number {
  if (daysSinceActivity <= 3) return 12;
  if (daysSinceActivity <= 7) return 10;
  if (daysSinceActivity <= 30) return 7;
  if (daysSinceActivity <= 90) return 4;
  if (daysSinceActivity <= 180) return 2;
  return 0;
}

function getTierBoost(tier: string | null | undefined): number {
  switch (tier) {
    case 'hot':
      return 4;
    case 'warm':
      return 2;
    case 'cool':
      return 1;
    case 'archived':
      return -3;
    case 'cold':
    default:
      return 0;
  }
}

export function normalizeSearchAlgoVersion(value: string | undefined | null): string {
  const normalized = (value || '').trim();
  if (!normalized) return DEFAULT_SEARCH_ALGO_VERSION;
  return CACHE_VERSION_PATTERN.test(normalized) ? normalized : DEFAULT_SEARCH_ALGO_VERSION;
}

export function normalizeSearchText(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchToken(token: string): string {
  const normalized = normalizeSearchText(token)
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!normalized) return '';
  return normalized.slice(0, MAX_TERM_LENGTH);
}

function splitTokens(value: string | null | undefined): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const tokens = normalized
    .split(TOKEN_SPLIT_REGEX)
    .map(normalizeSearchToken)
    .filter(Boolean)
    .filter((token) => token.length >= MIN_TERM_LENGTH);

  return tokens;
}

function mergeTerm(
  map: Map<string, SearchTermEntry>,
  rawTerm: string,
  source: string,
  baseWeight: number
): void {
  const term = normalizeSearchToken(rawTerm);
  if (!term || term.length < MIN_TERM_LENGTH) return;
  const weight = Math.max(0.1, Math.min(20, baseWeight));
  const existing = map.get(term);
  if (!existing) {
    map.set(term, { term, source, weight });
    return;
  }

  const nextWeight = Math.min(20, existing.weight + weight * 0.7);
  if (weight > existing.weight) {
    existing.source = source;
  }
  existing.weight = nextWeight;
}

function addTextTerms(
  map: Map<string, SearchTermEntry>,
  source: keyof typeof SOURCE_WEIGHTS,
  value: string | null | undefined
): void {
  if (!value) return;
  const tokens = splitTokens(value);
  for (const token of tokens) {
    mergeTerm(map, token, source, SOURCE_WEIGHTS[source]);
  }
}

export function buildSearchTermEntries(document: SearchTermsDocument): SearchTermEntry[] {
  const map = new Map<string, SearchTermEntry>();

  addTextTerms(map, 'name', document.name);
  addTextTerms(map, 'slug', document.slug);
  addTextTerms(map, 'repo', document.repoOwner);
  addTextTerms(map, 'repo', document.repoName);
  addTextTerms(map, 'description', document.description);

  for (const category of document.categories || []) {
    addTextTerms(map, 'category', category);
  }
  for (const tag of document.tags || []) {
    addTextTerms(map, 'tag', tag);
  }

  return Array.from(map.values())
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (a.term.length !== b.term.length) return a.term.length - b.term.length;
      return a.term.localeCompare(b.term);
    })
    .slice(0, MAX_TERMS_PER_SKILL)
    .map((entry) => ({
      term: entry.term,
      source: entry.source || DEFAULT_SOURCE,
      weight: Math.max(0.1, Math.round(entry.weight * 100) / 100),
    }));
}

/**
 * Query-agnostic search quality score.
 *
 * This score is precomputed offline and used online as a lightweight signal.
 * Query-time relevance is still applied separately in the API route.
 */
export function computeSearchScore(input: SearchScoreInput, now: number = Date.now()): number {
  const stars = toNonNegative(input.stars);
  const trendingScore = toNonNegative(input.trendingScore);
  const download30d = toNonNegative(input.downloadCount30d);
  const download90d = toNonNegative(input.downloadCount90d);
  const access30d = toNonNegative(input.accessCount30d);
  const activityAnchor = toNonNegative(input.lastCommitAt) || toNonNegative(input.updatedAt) || now;
  const daysSinceActivity = Math.max(0, (now - activityAnchor) / 86_400_000);

  const topRatedSignal = getTopRatedSortScore(stars, download90d);

  const topRatedComponent = Math.log2(topRatedSignal + 1) * 18;
  const trendingComponent = Math.log2(trendingScore + 1) * 16;
  const starsComponent = Math.log2(stars + 1) * 12;
  const installComponent = Math.log2(download30d + 1) * 10;
  const accessComponent = Math.log2(access30d + 1) * 6;
  const recencyBoost = getRecencyBoostDays(daysSinceActivity);
  const tierBoost = getTierBoost(input.tier);

  const rawScore = topRatedComponent
    + trendingComponent
    + starsComponent
    + installComponent
    + accessComponent
    + recencyBoost
    + tierBoost;

  return Math.max(0, Math.round(rawScore * 100) / 100);
}

export function getNextSearchUpdateAt(
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
      return now + 30 * 24 * 60 * 60 * 1000;
    case 'archived':
    default:
      return null;
  }
}

export async function markSearchDirty(
  db: D1Database | undefined,
  skillId: string,
  now: number = Date.now()
): Promise<void> {
  if (!db) return;
  await db.prepare(`
    INSERT INTO skill_search_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version, score,
      fail_count, last_error_at, created_at, updated_at
    )
    VALUES (?, 1, ?, NULL, NULL, NULL, 0, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 1,
      next_update_at = excluded.next_update_at,
      updated_at = excluded.updated_at
  `)
    .bind(skillId, now, now, now)
    .run();
}

export async function markSearchDirtyBatch(
  db: D1Database | undefined,
  skillIds: string[],
  now: number = Date.now()
): Promise<void> {
  if (!db || skillIds.length === 0) return;

  const uniqueIds = Array.from(new Set(skillIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const statement = db.prepare(`
    INSERT INTO skill_search_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version, score,
      fail_count, last_error_at, created_at, updated_at
    )
    VALUES (?, 1, ?, NULL, NULL, NULL, 0, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 1,
      next_update_at = excluded.next_update_at,
      updated_at = excluded.updated_at
  `);

  for (let i = 0; i < uniqueIds.length; i += SEARCH_STATE_BATCH_SIZE) {
    const chunk = uniqueIds.slice(i, i + SEARCH_STATE_BATCH_SIZE);
    await db.batch(
      chunk.map((skillId) => statement.bind(skillId, now, now, now))
    );
  }
}

export async function upsertSearchStateSuccess(
  db: D1Database | undefined,
  params: {
    skillId: string;
    tier: string | null | undefined;
    algoVersion: string;
    score: number;
    now?: number;
  }
): Promise<void> {
  if (!db) return;
  const now = params.now ?? Date.now();
  const nextUpdateAt = getNextSearchUpdateAt(params.tier, now);
  await db.prepare(`
    INSERT INTO skill_search_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version, score,
      fail_count, last_error_at, created_at, updated_at
    )
    VALUES (?, 0, ?, ?, ?, ?, 0, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 0,
      next_update_at = excluded.next_update_at,
      precomputed_at = excluded.precomputed_at,
      algo_version = excluded.algo_version,
      score = excluded.score,
      fail_count = 0,
      last_error_at = NULL,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, nextUpdateAt, now, params.algoVersion, params.score, now, now)
    .run();
}

export async function upsertSearchStateFailure(
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
    INSERT INTO skill_search_state (
      skill_id, dirty, next_update_at, precomputed_at, algo_version, score,
      fail_count, last_error_at, created_at, updated_at
    )
    VALUES (?, 1, ?, NULL, NULL, NULL, 1, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 1,
      next_update_at = excluded.next_update_at,
      fail_count = COALESCE(skill_search_state.fail_count, 0) + 1,
      last_error_at = excluded.last_error_at,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, nextUpdateAt, now, now, now)
    .run();
}

export async function replaceSearchTermsForSkill(
  db: D1Database | undefined,
  params: {
    skillId: string;
    terms: SearchTermEntry[];
    now?: number;
  }
): Promise<void> {
  if (!db) return;
  const now = params.now ?? Date.now();
  const skillId = params.skillId;

  await db.prepare('DELETE FROM skill_search_terms WHERE skill_id = ?')
    .bind(skillId)
    .run();

  if (!params.terms.length) {
    return;
  }

  const insertStmt = db.prepare(`
    INSERT INTO skill_search_terms (
      skill_id,
      term,
      source,
      weight,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  await db.batch(
    params.terms.map((entry) => insertStmt.bind(
      skillId,
      entry.term,
      entry.source || DEFAULT_SOURCE,
      entry.weight,
      now,
      now
    ))
  );
}
