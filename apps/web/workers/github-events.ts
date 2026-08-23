/**
 * GitHub Events Worker
 *
 * 轮询 GitHub Events API 刷新已知仓库，并在预算允许时使用 Code Search 发现新仓库
 * （追头 + 日期切片回填），另有零 API 配额的 HTML 仓库搜索爬虫补充发现
 * 通过 Cron Trigger 默认每 5 分钟执行一次
 */

import type { GithubEventsEnv, GitHubEvent, IndexingMessage } from './shared/types';
import {
  getGitHubRateLimitKVFromEnv,
  getGitHubRequestAuthFromEnv,
  withGitHubRateLimitKVOverride,
} from '../src/lib/server/github-client/env';
import {
  checkPublicSkillMdAtHead,
  fetchPublicSkillRepoSearchPage,
  PublicRepoSearchError,
} from '../src/lib/server/github-client/public-search';
import { getRateLimit, listPublicEvents, searchCode } from '../src/lib/server/github-client/rest';
import {
  isRateLimitSnapshotStale,
  readAggregatedRateLimitSnapshot,
  type GitHubRateLimitSnapshot,
} from '../src/lib/server/github-client/rate-limit-kv';
import {
  getGitHubTokenInputFromEnv,
  resolveGitHubTokenCandidates,
  resolveGitHubTokenIds,
} from '../src/lib/server/github-client/token-pool';
import {
  createMemoizedDurableObjectKvStore,
  isDurableObjectKvStore,
} from '../src/lib/server/state/client';

const DEFAULT_EVENTS_PER_PAGE = 100;
const DEFAULT_EVENTS_PAGES = 1;
const DEFAULT_EVENTS_KNOWN_REPOS_ONLY = true;
const DEFAULT_EVENTS_MAX_QUEUED_REPOS = 20;
const DEFAULT_EVENTS_MIN_REST_REMAINING = 1000;
const DEFAULT_EVENTS_REST_RESERVE = 300;
const DEFAULT_SEARCH_DISCOVERY_QUERY = 'filename:SKILL.md';
const DEFAULT_SEARCH_DISCOVERY_PAGES = 3;
const DEFAULT_SEARCH_DISCOVERY_PER_PAGE = 100;
const DEFAULT_SEARCH_DISCOVERY_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS = 5 * 60;
const DEFAULT_SEARCH_MIN_REMAINING = 2;
const DEFAULT_SEARCH_RESERVE = 2;
const DEFAULT_DISCOVERY_LOCK_TTL_SECONDS = 240;
const DEFAULT_REPO_QUEUE_DEDUP_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_EVENT_QUEUE_DEDUP_TTL_SECONDS = 5 * 60;
const DEFAULT_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_HTML_SEARCH_QUERIES = 'SKILL.md in:readme,agent skills in:readme,.claude/skills in:readme';
const DEFAULT_HTML_SEARCH_PAGES = 3;
const DEFAULT_HTML_SEARCH_MAX_CANDIDATES = 200;
const MAX_HTML_SEARCH_QUERIES = 8;
const MAX_HTML_SEARCH_PAGES = 10;
const MAX_HTML_SEARCH_CANDIDATES = 1000;
const MAX_DISCOVERY_PAGES = 10;
const MAX_DISCOVERY_PER_PAGE = 100;
const MAX_DISCOVERY_QUEUED_REPOS = 100;
const MAX_DISCOVERY_INTERVAL_SECONDS = 24 * 60 * 60;
const MAX_DISCOVERY_LOCK_TTL_SECONDS = 15 * 60;
const MAX_QUEUE_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SEARCH_BACKFILL_INTERVAL_SECONDS = 60 * 60;
const DEFAULT_SEARCH_BACKFILL_START_DATE = '2025-01-01';
const DEFAULT_SEARCH_BACKFILL_MIN_REMAINING = 5;
const DEFAULT_SEARCH_BACKFILL_RESERVE = 5;
const DEFAULT_SEARCH_BACKFILL_MAX_PAGES = 3;

const RATE_LIMIT_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const D1_MAX_BOUND_PARAMETERS = 100;
const REPO_IDENTITY_BOUND_PARAMETERS = 2;
const D1_REPO_IDENTITY_CHUNK_SIZE = Math.floor(
  D1_MAX_BOUND_PARAMETERS / REPO_IDENTITY_BOUND_PARAMETERS
);

const RUN_LOCK_KEY = 'github-discovery:run-lock';
const CODE_SEARCH_CURSOR_KEY = 'github-events:code-search:last-head';
const CODE_SEARCH_BACKFILL_CURSOR_KEY = 'github-events:code-search:backfill-cursor';
const EVENT_REPLAY_STATE_KEY = 'github-events:event-replay-state';
const REPO_QUEUE_DEDUP_WINDOW_KEY = 'github-events:repo-queued-window';

interface SearchDiscoveryResult {
  scanned: number;
  queued: number;
  pagesFetched: number;
  allowedPages: number;
  stoppedByCursor: boolean;
  remainingAfter?: number;
  resetAtEpochSecAfter?: number;
  skippedReason?: string;
}

interface CodeSearchBackfillResult {
  scanned: number;
  queued: number;
  pagesFetched: number;
  allowedPages: number;
  date?: string;
  skippedReason?: string;
}

interface HtmlSearchDiscoveryResult {
  scanned: number;
  queued: number;
  pagesFetched: number;
  skippedReason?: string;
}

interface EventsDiscoveryResult {
  processed: number;
  queued: number;
  unknownSkipped: number;
  pagesFetched: number;
  allowedPages: number;
  skippedReason?: string;
}

interface RepoIdentity {
  owner: string;
  name: string;
}

type QueuedRepoSet = Set<string>;

interface RepoQueuedWindowPayload {
  entries?: Record<string, number>;
}

interface RepoQueueDedupeState {
  recentUntilByIdentity: Map<string, number>;
  queuedInRun: QueuedRepoSet;
  dirty: boolean;
}

interface GitHubEventsFetchResult {
  events: GitHubEvent[];
  rateLimited: boolean;
}

interface GitHubCodeSearchItem {
  sha: string;
  path: string;
  repository?: {
    full_name?: string;
  };
}

interface GitHubCodeSearchResponse {
  items?: GitHubCodeSearchItem[];
}

interface DiscoveryRunLockPayload {
  token: string;
  acquiredAtEpochMs: number;
  expiresAtEpochMs: number;
}

interface EventReplayStatePayload {
  baseLastEventId: string | null;
  processedPushEventIds: string[];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function parseClampedPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  return Math.min(parsePositiveInt(raw, fallback), max);
}

function parseEnabled(raw: string | undefined, fallback: boolean = true): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

function normalizeSkillPath(skillPath?: string): string {
  return (skillPath || '').replace(/^\/+|\/+$/g, '');
}

function parseRepoFullName(fullName: string | undefined): RepoIdentity | null {
  if (!fullName) return null;
  const [owner, name] = fullName.split('/');
  if (!owner || !name) return null;
  return { owner, name };
}

function getSkillPathFromSkillMdPath(path: string): string | undefined {
  const normalized = path.replace(/^\/+/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return undefined;
  const parent = normalized.slice(0, idx);
  return parent || undefined;
}

function isSkillMdPath(path: string): boolean {
  const name = path.split('/').pop()?.toLowerCase();
  return name === 'skill.md';
}

function buildSearchFingerprint(item: GitHubCodeSearchItem): string | null {
  const repoFullName = item.repository?.full_name?.toLowerCase();
  const path = item.path?.toLowerCase();
  const sha = item.sha?.toLowerCase();
  if (!repoFullName || !path || !sha) return null;
  return `${repoFullName}#${path}#${sha}`;
}

function isGitHubRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after');
}

function getEventsPerPage(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_EVENTS_PER_PAGE, DEFAULT_EVENTS_PER_PAGE, MAX_DISCOVERY_PER_PAGE);
}

function getEventsDiscoveryConfig(env: GithubEventsEnv): {
  pages: number;
  perPage: number;
  knownReposOnly: boolean;
  maxQueuedRepos: number;
  cronIntervalSeconds: number;
  minRestRemaining: number;
  restReserve: number;
} {
  return {
    pages: parseClampedPositiveInt(env.GITHUB_EVENTS_PAGES, DEFAULT_EVENTS_PAGES, MAX_DISCOVERY_PAGES),
    perPage: getEventsPerPage(env),
    knownReposOnly: parseEnabled(
      env.GITHUB_EVENTS_KNOWN_REPOS_ONLY,
      DEFAULT_EVENTS_KNOWN_REPOS_ONLY
    ),
    maxQueuedRepos: parseClampedPositiveInt(
      env.GITHUB_EVENTS_MAX_QUEUED_REPOS,
      DEFAULT_EVENTS_MAX_QUEUED_REPOS,
      MAX_DISCOVERY_QUEUED_REPOS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    minRestRemaining: parsePositiveInt(
      env.GITHUB_EVENTS_MIN_REST_REMAINING,
      DEFAULT_EVENTS_MIN_REST_REMAINING
    ),
    restReserve: parsePositiveInt(env.GITHUB_EVENTS_REST_RESERVE, DEFAULT_EVENTS_REST_RESERVE),
  };
}

function getSearchDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean;
  query: string;
  pages: number;
  perPage: number;
  intervalSeconds: number;
  cronIntervalSeconds: number;
  minRestRemaining: number;
  restReserve: number;
} {
  return {
    enabled: parseEnabled(env.GITHUB_SEARCH_DISCOVERY_ENABLED, true),
    query: (env.GITHUB_SEARCH_DISCOVERY_QUERY || DEFAULT_SEARCH_DISCOVERY_QUERY).trim() || DEFAULT_SEARCH_DISCOVERY_QUERY,
    pages: parseClampedPositiveInt(env.GITHUB_SEARCH_DISCOVERY_PAGES, DEFAULT_SEARCH_DISCOVERY_PAGES, MAX_DISCOVERY_PAGES),
    perPage: parseClampedPositiveInt(env.GITHUB_SEARCH_DISCOVERY_PER_PAGE, DEFAULT_SEARCH_DISCOVERY_PER_PAGE, MAX_DISCOVERY_PER_PAGE),
    intervalSeconds: parseClampedPositiveInt(
      env.GITHUB_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      DEFAULT_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    minRestRemaining: parsePositiveInt(
      env.GITHUB_SEARCH_DISCOVERY_MIN_REMAINING,
      DEFAULT_SEARCH_MIN_REMAINING
    ),
    restReserve: parsePositiveInt(
      env.GITHUB_SEARCH_DISCOVERY_RESERVE,
      DEFAULT_SEARCH_RESERVE
    ),
  };
}

function getDiscoveryLockTtlSeconds(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_DISCOVERY_LOCK_TTL_SECONDS, DEFAULT_DISCOVERY_LOCK_TTL_SECONDS, MAX_DISCOVERY_LOCK_TTL_SECONDS);
}

function getRepoQueueDedupTtlSeconds(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_REPO_QUEUE_DEDUP_TTL_SECONDS, DEFAULT_REPO_QUEUE_DEDUP_TTL_SECONDS, MAX_QUEUE_DEDUP_TTL_SECONDS);
}

function getEventQueueDedupTtlSeconds(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_EVENT_QUEUE_DEDUP_TTL_SECONDS, DEFAULT_EVENT_QUEUE_DEDUP_TTL_SECONDS, MAX_QUEUE_DEDUP_TTL_SECONDS);
}

function parseDateOnly(raw: string | undefined, fallback: string): string {
  const value = (raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : fallback;
}

function formatDateOnly(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function addDaysToDateOnly(date: string, days: number): string {
  return formatDateOnly(Date.parse(`${date}T00:00:00Z`) + days * 86400_000);
}

function getHtmlSearchDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean;
  intervalSeconds: number;
  cronIntervalSeconds: number;
  queries: string[];
  pages: number;
  maxCandidates: number;
} {
  const rawQueries = (env.GITHUB_HTML_SEARCH_QUERIES || DEFAULT_HTML_SEARCH_QUERIES)
    .split(',')
    .map((query) => query.trim())
    .filter(Boolean);
  return {
    enabled: parseEnabled(env.GITHUB_HTML_SEARCH_DISCOVERY_ENABLED, true),
    intervalSeconds: parseClampedPositiveInt(
      env.GITHUB_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      DEFAULT_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    queries: rawQueries.length > 0
      ? rawQueries.slice(0, MAX_HTML_SEARCH_QUERIES)
      : [DEFAULT_HTML_SEARCH_QUERIES],
    pages: Math.min(
      parseClampedPositiveInt(env.GITHUB_HTML_SEARCH_PAGES, DEFAULT_HTML_SEARCH_PAGES, MAX_HTML_SEARCH_PAGES),
      MAX_HTML_SEARCH_PAGES
    ),
    maxCandidates: Math.min(
      parseClampedPositiveInt(env.GITHUB_HTML_SEARCH_MAX_CANDIDATES, DEFAULT_HTML_SEARCH_MAX_CANDIDATES, MAX_HTML_SEARCH_CANDIDATES),
      MAX_HTML_SEARCH_CANDIDATES
    ),
  };
}

function getSearchBackfillConfig(env: GithubEventsEnv): {
  enabled: boolean;
  intervalSeconds: number;
  startDate: string;
  minRemaining: number;
  reserve: number;
  maxPages: number;
  perPage: number;
  cronIntervalSeconds: number;
} {
  return {
    enabled: parseEnabled(env.GITHUB_SEARCH_BACKFILL_ENABLED, true),
    intervalSeconds: parseClampedPositiveInt(
      env.GITHUB_SEARCH_BACKFILL_INTERVAL_SECONDS,
      DEFAULT_SEARCH_BACKFILL_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    startDate: parseDateOnly(env.GITHUB_SEARCH_BACKFILL_START_DATE, DEFAULT_SEARCH_BACKFILL_START_DATE),
    minRemaining: parsePositiveInt(
      env.GITHUB_SEARCH_BACKFILL_MIN_REMAINING,
      DEFAULT_SEARCH_BACKFILL_MIN_REMAINING
    ),
    reserve: parsePositiveInt(env.GITHUB_SEARCH_BACKFILL_RESERVE, DEFAULT_SEARCH_BACKFILL_RESERVE),
    maxPages: parseClampedPositiveInt(env.GITHUB_SEARCH_BACKFILL_MAX_PAGES, DEFAULT_SEARCH_BACKFILL_MAX_PAGES, MAX_DISCOVERY_PAGES),
    perPage: parseClampedPositiveInt(env.GITHUB_SEARCH_DISCOVERY_PER_PAGE, DEFAULT_SEARCH_DISCOVERY_PER_PAGE, MAX_DISCOVERY_PER_PAGE),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
  };
}

function getGithubEventsStateStore(env: GithubEventsEnv): KVNamespace {
  return env.KV;
}

export function buildRepoQueuedDedupIdentity(owner: string, name: string, skillPath?: string): string {
  const normalizedPath = normalizeSkillPath(skillPath).toLowerCase();
  return `${owner.toLowerCase()}/${name.toLowerCase()}:${normalizedPath}`;
}

export function shouldRunSearchDiscoveryThisTick(
  nowMs: number,
  cronIntervalSeconds: number,
  searchIntervalSeconds: number
): boolean {
  const normalizedCronInterval = Math.max(1, Math.floor(cronIntervalSeconds));
  const normalizedSearchInterval = Math.max(1, Math.floor(searchIntervalSeconds));

  if (normalizedSearchInterval <= normalizedCronInterval) {
    return true;
  }

  const nowEpochSec = Math.floor(nowMs / 1000);
  return (nowEpochSec % normalizedSearchInterval) < normalizedCronInterval;
}

export function computeAllowedSearchPages(
  configuredPages: number,
  remaining: number,
  resetAtEpochSec: number,
  cronIntervalSeconds: number,
  reserve: number,
  nowMs: number = Date.now()
): number {
  if (configuredPages <= 0) return 0;

  const safeRemaining = Math.max(0, remaining - reserve);
  if (safeRemaining <= 0) return 0;

  const nowSec = Math.floor(nowMs / 1000);
  const secondsUntilReset = Math.max(0, resetAtEpochSec - nowSec);
  const runsUntilReset = Math.max(1, Math.ceil(secondsUntilReset / Math.max(1, cronIntervalSeconds)));
  const safeBudget = Math.floor(safeRemaining / runsUntilReset);

  return Math.min(configuredPages, Math.max(0, safeBudget));
}

/**
 * 获取 GitHub Events
 */
async function fetchGitHubEvents(
  env: GithubEventsEnv,
  page: number,
  perPage: number
): Promise<GitHubEventsFetchResult> {
  const response = await listPublicEvents({
    page,
    perPage,
    // Budget snapshots are refreshed explicitly via /rate_limit.
    // Keep discovery requests themselves write-free for KV cost control.
    ...getGitHubRequestAuthFromEnv(env, { rateLimitMode: 'read_only' }),
    userAgent: 'SkillsCat-Worker/1.0',
  });
  if (!response.ok) {
    if (isGitHubRateLimited(response)) {
      return { events: [], rateLimited: true };
    }
    throw new Error(`Failed to fetch GitHub events: ${response.status}`);
  }
  return {
    events: await response.json() as GitHubEvent[],
    rateLimited: false,
  };
}

/**
 * 从事件中提取仓库信息
 */
function extractRepoInfo(event: GitHubEvent): IndexingMessage | null {
  if (!event.repo) return null;

  const [owner, name] = event.repo.name.split('/');
  if (!owner || !name) return null;

  return {
    type: 'check_skill',
    repoOwner: owner,
    repoName: name,
    eventId: event.id,
    eventType: event.type,
    createdAt: event.created_at,
    ...(event.payload?.head ? { headSha: event.payload.head } : {}),
    ...(event.payload?.ref ? { gitRef: event.payload.ref } : {}),
    discoverySource: 'github-events',
  };
}

export async function loadKnownGitHubRepoIdentities(
  db: D1Database,
  repos: RepoIdentity[]
): Promise<Set<string>> {
  const unique = new Map<string, RepoIdentity>();
  for (const repo of repos) {
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (!unique.has(identity)) unique.set(identity, repo);
  }
  if (unique.size === 0) return new Set();

  const candidates = [...unique.values()];
  const known = new Set<string>();

  for (let offset = 0; offset < candidates.length; offset += D1_REPO_IDENTITY_CHUNK_SIZE) {
    const chunk = candidates.slice(offset, offset + D1_REPO_IDENTITY_CHUNK_SIZE);
    const valuesSql = chunk.map(() => '(?, ?)').join(', ');
    const bindings = chunk.flatMap((repo) => [repo.owner, repo.name]);
    const result = await db.prepare(`
      WITH candidate_repos(repo_owner, repo_name) AS (
        VALUES ${valuesSql}
      )
      SELECT c.repo_owner AS repoOwner, c.repo_name AS repoName
      FROM candidate_repos c
      WHERE EXISTS (
        SELECT 1
        FROM skill_sources AS s INDEXED BY skill_sources_repo_path_unique
        WHERE s.repo_owner = c.repo_owner
          AND s.repo_name = c.repo_name
        LIMIT 1
      ) OR EXISTS (
        SELECT 1
        FROM skills AS sk INDEXED BY skills_repo_path_unique
        WHERE sk.repo_owner = c.repo_owner
          AND sk.repo_name = c.repo_name
        LIMIT 1
      )
    `)
      .bind(...bindings)
      .all<{ repoOwner: string; repoName: string }>();

    for (const row of result.results || []) {
      known.add(`${row.repoOwner.toLowerCase()}/${row.repoName.toLowerCase()}`);
    }
  }

  return known;
}

/**
 * 获取上次处理的事件 ID
 */
async function getLastProcessedEventId(env: GithubEventsEnv): Promise<string | null> {
  return getGithubEventsStateStore(env).get('github-events:last-event-id');
}

/**
 * 保存最后处理的事件 ID
 */
async function setLastProcessedEventId(env: GithubEventsEnv, eventId: string): Promise<void> {
  await getGithubEventsStateStore(env).put('github-events:last-event-id', eventId, {
    expirationTtl: 86400 * 7,
  });
}

async function persistProcessedEventCursor(
  env: GithubEventsEnv,
  lastEventId: string | null,
  newestEventId: string | null
): Promise<void> {
  if (!newestEventId || newestEventId === lastEventId) {
    return;
  }

  await setLastProcessedEventId(env, newestEventId);
}

async function readEventReplayState(
  env: GithubEventsEnv,
  lastEventId: string | null
): Promise<Set<string>> {
  const store = getGithubEventsStateStore(env);
  const raw = await store.get(EVENT_REPLAY_STATE_KEY);
  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EventReplayStatePayload>;
    const baseLastEventId = parsed.baseLastEventId === null || typeof parsed.baseLastEventId === 'string'
      ? parsed.baseLastEventId
      : null;
    const processedPushEventIds = Array.isArray(parsed.processedPushEventIds)
      ? parsed.processedPushEventIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];

    if (baseLastEventId !== lastEventId || processedPushEventIds.length === 0) {
      await store.delete(EVENT_REPLAY_STATE_KEY);
      return new Set();
    }

    return new Set(processedPushEventIds);
  } catch {
    await store.delete(EVENT_REPLAY_STATE_KEY);
    return new Set();
  }
}

async function persistEventReplayState(
  env: GithubEventsEnv,
  lastEventId: string | null,
  processedPushEventIds: Set<string>
): Promise<void> {
  if (processedPushEventIds.size === 0) {
    return;
  }

  const payload: EventReplayStatePayload = {
    baseLastEventId: lastEventId,
    processedPushEventIds: [...processedPushEventIds],
  };

  await getGithubEventsStateStore(env).put(EVENT_REPLAY_STATE_KEY, JSON.stringify(payload), {
    expirationTtl: 24 * 60 * 60,
  });
}

async function clearEventReplayState(env: GithubEventsEnv): Promise<void> {
  await getGithubEventsStateStore(env).delete(EVENT_REPLAY_STATE_KEY);
}

async function readRepoQueueDedupeState(
  env: GithubEventsEnv,
  nowMs: number
): Promise<RepoQueueDedupeState> {
  const raw = await getGithubEventsStateStore(env).get(REPO_QUEUE_DEDUP_WINDOW_KEY);
  if (!raw) {
    return {
      recentUntilByIdentity: new Map(),
      queuedInRun: new Set(),
      dirty: false,
    };
  }

  try {
    const parsed = JSON.parse(raw) as RepoQueuedWindowPayload;
    const entries = isObject(parsed.entries) ? parsed.entries : {};
    const recentUntilByIdentity = new Map<string, number>();

    for (const [identity, expiresAtEpochMs] of Object.entries(entries)) {
      const expiresAt = Number(expiresAtEpochMs);
      if (!identity || !Number.isFinite(expiresAt) || expiresAt <= nowMs) {
        continue;
      }
      recentUntilByIdentity.set(identity, expiresAt);
    }

    return {
      recentUntilByIdentity,
      queuedInRun: new Set(),
      dirty: false,
    };
  } catch {
    return {
      recentUntilByIdentity: new Map(),
      queuedInRun: new Set(),
      dirty: true,
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wasRepoQueuedRecently(
  state: RepoQueueDedupeState,
  owner: string,
  name: string,
  skillPath: string | undefined,
  nowMs: number
): boolean {
  const identity = buildRepoQueuedDedupIdentity(owner, name, skillPath);
  if (state.queuedInRun.has(identity)) {
    return true;
  }

  const expiresAt = state.recentUntilByIdentity.get(identity);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt > nowMs) {
    return true;
  }

  state.recentUntilByIdentity.delete(identity);
  state.dirty = true;
  return false;
}

function markRepoQueued(
  state: RepoQueueDedupeState,
  owner: string,
  name: string,
  skillPath: string | undefined,
  nowMs: number,
  ttlSeconds: number
): void {
  const identity = buildRepoQueuedDedupIdentity(owner, name, skillPath);
  state.queuedInRun.add(identity);
  state.recentUntilByIdentity.set(identity, nowMs + ttlSeconds * 1000);
  state.dirty = true;
}

async function persistRepoQueueDedupeState(
  env: GithubEventsEnv,
  state: RepoQueueDedupeState,
  nowMs: number
): Promise<void> {
  if (!state.dirty) {
    return;
  }

  const ttlSeconds = getRepoQueueDedupTtlSeconds(env);
  const entries: Record<string, number> = {};
  for (const [identity, expiresAtEpochMs] of state.recentUntilByIdentity.entries()) {
    if (expiresAtEpochMs > nowMs) {
      entries[identity] = expiresAtEpochMs;
    }
  }

  await getGithubEventsStateStore(env).put(REPO_QUEUE_DEDUP_WINDOW_KEY, JSON.stringify({ entries }), {
    expirationTtl: ttlSeconds * 2,
  });
}

async function getCodeSearchHeadCursor(env: GithubEventsEnv): Promise<string | null> {
  return getGithubEventsStateStore(env).get(CODE_SEARCH_CURSOR_KEY);
}

async function setCodeSearchHeadCursor(env: GithubEventsEnv, fingerprint: string): Promise<void> {
  await getGithubEventsStateStore(env).put(CODE_SEARCH_CURSOR_KEY, fingerprint, {
    expirationTtl: 86400 * 30,
  });
}

async function readGitHubRateLimitBudget(
  env: GithubEventsEnv,
  bucket: 'rest' | 'search' | 'graphql',
  options: { maxAgeMs?: number; includeStale?: boolean } = {}
): Promise<GitHubRateLimitSnapshot | null> {
  const tokenIds = await resolveGitHubTokenIds(getGitHubTokenInputFromEnv(env));
  // The anonymous GitHub API pool is only 60 requests/hour and is shared by
  // Worker egress. Discovery must stop instead of silently falling back to it.
  if (tokenIds.length === 0) return null;

  return readAggregatedRateLimitSnapshot(bucket, {
    kv: getGitHubRateLimitKVFromEnv(env),
    tokenIds,
    maxAgeMs: options.maxAgeMs,
    includeStale: options.includeStale,
  });
}

async function readOrRefreshRateLimitSnapshot(
  env: GithubEventsEnv,
  bucket: 'rest' | 'search'
): Promise<GitHubRateLimitSnapshot | null> {
  let snapshot = await readGitHubRateLimitBudget(env, bucket, {
    maxAgeMs: RATE_LIMIT_SNAPSHOT_MAX_AGE_MS,
  });

  if (!isRateLimitSnapshotStale(snapshot, RATE_LIMIT_SNAPSHOT_MAX_AGE_MS)) {
    return snapshot;
  }

  try {
    const tokenCandidates = await resolveGitHubTokenCandidates(getGitHubTokenInputFromEnv(env));

    for (const candidate of tokenCandidates) {
      const response = await getRateLimit({
        token: candidate.value,
        userAgent: 'SkillsCat-Worker/1.0',
        rateLimitKV: getGitHubRateLimitKVFromEnv(env),
      });

      if (!response.ok) {
        console.warn(`Failed to refresh GitHub rate limit snapshot for token ${candidate.id}: ${response.status}`);
      }
    }
  } catch (error) {
    console.warn('Failed to refresh GitHub rate limit snapshot due to network error:', error);
  }

  snapshot = await readGitHubRateLimitBudget(env, bucket, {
    maxAgeMs: RATE_LIMIT_SNAPSHOT_MAX_AGE_MS,
  });
  return snapshot;
}

/**
 * 处理 GitHub Events
 */
async function processEvents(
  env: GithubEventsEnv,
  restSnapshot: GitHubRateLimitSnapshot | null,
  repoDedupeState: RepoQueueDedupeState,
  nowMs: number
): Promise<EventsDiscoveryResult> {
  let processed = 0;
  let queued = 0;
  let unknownSkipped = 0;
  let pagesFetched = 0;

  const config = getEventsDiscoveryConfig(env);

  if (!restSnapshot) {
    return {
      processed,
      queued,
      unknownSkipped,
      pagesFetched,
      allowedPages: 0,
      skippedReason: 'missing_rate_limit',
    };
  }

  if (restSnapshot.remaining < config.minRestRemaining) {
    return {
      processed,
      queued,
      unknownSkipped,
      pagesFetched,
      allowedPages: 0,
      skippedReason: 'insufficient_rest_remaining',
    };
  }

  const allowedPages = computeAllowedSearchPages(
    config.pages,
    restSnapshot.remaining,
    restSnapshot.resetAtEpochSec,
    config.cronIntervalSeconds,
    config.restReserve
  );

  if (allowedPages <= 0) {
    return {
      processed,
      queued,
      unknownSkipped,
      pagesFetched,
      allowedPages: 0,
      skippedReason: 'budget_exhausted',
    };
  }

  let lastEventId: string | null = null;
  let replayedPushEventIds = new Set<string>();
  let hadReplayState = false;

  try {
    lastEventId = await getLastProcessedEventId(env);
    replayedPushEventIds = await readEventReplayState(env, lastEventId);
    hadReplayState = replayedPushEventIds.size > 0;
    let newestEventId: string | null = null;
    let reachedLastProcessed = false;
    let deferredByQueueCap = false;

    for (let page = 1; page <= allowedPages; page++) {
      const fetchResult = await fetchGitHubEvents(env, page, config.perPage);
      if (fetchResult.rateLimited) {
        if (replayedPushEventIds.size > 0) {
          await persistEventReplayState(env, lastEventId, replayedPushEventIds);
        }
        return {
          processed,
          queued,
          unknownSkipped,
          pagesFetched,
          allowedPages,
          skippedReason: 'events_rate_limited',
        };
      }

      const events = fetchResult.events;
      pagesFetched++;

      if (events.length === 0) {
        break;
      }

      const sortedEvents = events.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      if (!newestEventId && sortedEvents.length > 0) {
        newestEventId = sortedEvents[0].id;
      }

      const pushCandidates: Array<{ event: GitHubEvent; message: IndexingMessage }> = [];

      for (const event of sortedEvents) {
        if (event.id === lastEventId) {
          reachedLastProcessed = true;
          break;
        }

        if (replayedPushEventIds.has(event.id)) {
          continue;
        }

        processed++;

        if (event.type !== 'PushEvent') {
          // Non-push events do not enqueue any work, so we can safely rely on the
          // last processed cursor without persisting per-event dedupe state.
          continue;
        }

        const message = extractRepoInfo(event);
        if (message) pushCandidates.push({ event, message });
      }

      let knownRepoIdentities: Set<string> | null = null;
      if (config.knownReposOnly && pushCandidates.length > 0) {
        try {
          knownRepoIdentities = await loadKnownGitHubRepoIdentities(
            env.DB,
            pushCandidates.map(({ message }) => ({
              owner: message.repoOwner,
              name: message.repoName,
            }))
          );
        } catch (error) {
          console.warn('Failed to load known GitHub repositories; preserving the event cursor for retry:', error);
          throw error;
        }
      }

      for (const { event, message } of pushCandidates) {
        const repoIdentity = `${message.repoOwner.toLowerCase()}/${message.repoName.toLowerCase()}`;
        if (knownRepoIdentities && !knownRepoIdentities.has(repoIdentity)) {
          unknownSkipped++;
          replayedPushEventIds.add(event.id);
          continue;
        }

        if (wasRepoQueuedRecently(repoDedupeState, message.repoOwner, message.repoName, undefined, nowMs)) {
          replayedPushEventIds.add(event.id);
          continue;
        }

        if (queued >= config.maxQueuedRepos) {
          deferredByQueueCap = true;
          break;
        }

        await env.INDEXING_QUEUE.send(message);
        markRepoQueued(repoDedupeState, message.repoOwner, message.repoName, undefined, nowMs, getEventQueueDedupTtlSeconds(env));
        queued++;
        console.log(`Queued known repo for indexing: ${message.repoOwner}/${message.repoName}`);
        replayedPushEventIds.add(event.id);
      }

      if (deferredByQueueCap) {
        break;
      }

      if (reachedLastProcessed || events.length < config.perPage) {
        break;
      }
    }

    if (deferredByQueueCap) {
      await persistEventReplayState(env, lastEventId, replayedPushEventIds);
      return {
        processed,
        queued,
        unknownSkipped,
        pagesFetched,
        allowedPages,
        skippedReason: 'queue_cap_reached',
      };
    }

    if (hadReplayState) {
      await clearEventReplayState(env);
    }
    await persistProcessedEventCursor(env, lastEventId, newestEventId);
  } catch (error) {
    try {
      if (replayedPushEventIds.size > 0) {
        await persistEventReplayState(env, lastEventId, replayedPushEventIds);
      }
    } catch (replayStateError) {
      console.error('Failed to persist GitHub event replay state:', replayStateError);
    }
    console.error('Error processing GitHub events:', error);
    throw error;
  }

  return {
    processed,
    queued,
    unknownSkipped,
    pagesFetched,
    allowedPages,
  };
}

/**
 * 处理一页 code search 结果:过滤 SKILL.md → run 内去重 → 窗口去重 → 入队。
 * previousHeadCursor 仅追头路径使用;回填传 null 不做游标截停。
 */
async function queueCodeSearchItems(
  env: GithubEventsEnv,
  items: GitHubCodeSearchItem[],
  repoDedupeState: RepoQueueDedupeState,
  seenFingerprints: Set<string>,
  previousHeadCursor: string | null,
  nowMs: number
): Promise<{ scanned: number; queued: number; stoppedByCursor: boolean }> {
  let scanned = 0;
  let queued = 0;
  let stoppedByCursor = false;
  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);

  for (const item of items) {
    scanned++;

    if (!isSkillMdPath(item.path)) {
      continue;
    }

    const fingerprint = buildSearchFingerprint(item);
    if (!fingerprint) {
      continue;
    }

    if (previousHeadCursor && fingerprint === previousHeadCursor) {
      stoppedByCursor = true;
      break;
    }

    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);

    const repo = parseRepoFullName(item.repository?.full_name);
    if (!repo) {
      continue;
    }

    const skillPath = getSkillPathFromSkillMdPath(item.path);
    if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, skillPath, nowMs)) {
      continue;
    }

    const message: IndexingMessage = {
      type: 'check_skill',
      repoOwner: repo.owner,
      repoName: repo.name,
      skillPath,
      skillFilePath: item.path,
      discoverySource: 'github-code-search',
      discoveryFingerprint: fingerprint,
    };

    await env.INDEXING_QUEUE.send(message);
    markRepoQueued(repoDedupeState, repo.owner, repo.name, skillPath, nowMs, dedupTtlSeconds);
    queued++;
  }

  return { scanned, queued, stoppedByCursor };
}

async function processCodeSearchDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  initialSearchSnapshot?: GitHubRateLimitSnapshot | null,
  nowMs: number = Date.now()
): Promise<SearchDiscoveryResult> {
  const config = getSearchDiscoveryConfig(env);
  const baseResult: SearchDiscoveryResult = {
    scanned: 0,
    queued: 0,
    pagesFetched: 0,
    allowedPages: 0,
    stoppedByCursor: false,
  };

  if (!config.enabled) {
    return {
      ...baseResult,
      skippedReason: 'disabled',
    };
  }

  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return {
      ...baseResult,
      skippedReason: 'interval_throttled',
    };
  }

  const searchSnapshot = (!initialSearchSnapshot || isRateLimitSnapshotStale(initialSearchSnapshot, RATE_LIMIT_SNAPSHOT_MAX_AGE_MS))
    ? await readOrRefreshRateLimitSnapshot(env, 'search')
    : initialSearchSnapshot;
  if (!searchSnapshot) {
    return {
      ...baseResult,
      skippedReason: 'missing_rate_limit',
    };
  }

  const snapshotResult = (result: SearchDiscoveryResult): SearchDiscoveryResult => ({
    ...result,
    remainingAfter: Math.max(0, searchSnapshot.remaining - result.pagesFetched),
    resetAtEpochSecAfter: searchSnapshot.resetAtEpochSec,
  });

  if (searchSnapshot.remaining < config.minRestRemaining) {
    return snapshotResult({
      ...baseResult,
      skippedReason: 'insufficient_rest_remaining',
    });
  }

  const allowedPages = computeAllowedSearchPages(
    config.pages,
    searchSnapshot.remaining,
    searchSnapshot.resetAtEpochSec,
    config.cronIntervalSeconds,
    config.restReserve
  );

  if (allowedPages <= 0) {
    return snapshotResult({
      ...baseResult,
      allowedPages,
      skippedReason: 'budget_exhausted',
    });
  }

  const previousHeadCursor = await getCodeSearchHeadCursor(env);
  const seenFingerprints = new Set<string>();
  let stoppedByCursor = false;
  let queued = 0;
  let scanned = 0;
  let pagesFetched = 0;
  let nextHeadCursor: string | null = null;

  for (let page = 1; page <= allowedPages; page++) {
    const response = await searchCode(config.query, {
      page,
      perPage: config.perPage,
      sort: 'indexed',
      order: 'desc',
      // Budget snapshots are refreshed explicitly via /rate_limit.
      // Keep discovery requests themselves write-free for KV cost control.
      ...getGitHubRequestAuthFromEnv(env, { rateLimitMode: 'read_only' }),
      userAgent: 'SkillsCat-Worker/1.0',
    });

    if (!response.ok) {
      if (isGitHubRateLimited(response)) {
        return snapshotResult({
          scanned,
          queued,
          pagesFetched,
          allowedPages,
          stoppedByCursor,
          skippedReason: 'search_rate_limited',
        });
      }
      throw new Error(`Failed to fetch GitHub code search: ${response.status}`);
    }

    const payload = await response.json() as GitHubCodeSearchResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];

    pagesFetched++;
    if (page === 1 && items.length > 0) {
      nextHeadCursor = buildSearchFingerprint(items[0]);
    }

    const outcome = await queueCodeSearchItems(
      env,
      items,
      repoDedupeState,
      seenFingerprints,
      previousHeadCursor,
      nowMs
    );
    scanned += outcome.scanned;
    queued += outcome.queued;
    if (outcome.stoppedByCursor) {
      stoppedByCursor = true;
    }

    if (stoppedByCursor) {
      break;
    }

    if (items.length < config.perPage) {
      break;
    }
  }

  if (nextHeadCursor && nextHeadCursor !== previousHeadCursor) {
    await setCodeSearchHeadCursor(env, nextHeadCursor);
  }

  return snapshotResult({
    scanned,
    queued,
    pagesFetched,
    allowedPages,
    stoppedByCursor,
  });
}

async function getCodeSearchBackfillCursor(env: GithubEventsEnv): Promise<string | null> {
  const raw = await getGithubEventsStateStore(env).get(CODE_SEARCH_BACKFILL_CURSOR_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { date?: unknown };
    return typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
      ? parsed.date
      : null;
  } catch {
    return null;
  }
}

async function setCodeSearchBackfillCursor(env: GithubEventsEnv, date: string): Promise<void> {
  await getGithubEventsStateStore(env).put(CODE_SEARCH_BACKFILL_CURSOR_KEY, JSON.stringify({ date }), {
    expirationTtl: 86400 * 30,
  });
}

/**
 * Code Search 日期切片回填:每 tick 处理一个 `created:<date>..<date>` 切片,
 * 游标前进一天;到达今天后回卷到起始日期重扫,捕获漏网仓库。
 * 严格受 search 预算约束,快照不可用或余量不足时整体跳过。
 */
async function processCodeSearchBackfill(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  initialSearchSnapshot?: GitHubRateLimitSnapshot | null,
  nowMs: number = Date.now(),
  pageBudgetOverride?: number
): Promise<CodeSearchBackfillResult> {
  const config = getSearchBackfillConfig(env);
  const baseResult: CodeSearchBackfillResult = {
    scanned: 0,
    queued: 0,
    pagesFetched: 0,
    allowedPages: 0,
  };

  if (!config.enabled) {
    return { ...baseResult, skippedReason: 'disabled' };
  }

  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...baseResult, skippedReason: 'interval_throttled' };
  }

  const searchSnapshot = (!initialSearchSnapshot || isRateLimitSnapshotStale(initialSearchSnapshot, RATE_LIMIT_SNAPSHOT_MAX_AGE_MS))
    ? await readOrRefreshRateLimitSnapshot(env, 'search')
    : initialSearchSnapshot;
  if (!searchSnapshot) {
    return { ...baseResult, skippedReason: 'missing_rate_limit' };
  }

  if (searchSnapshot.remaining < config.minRemaining) {
    return { ...baseResult, skippedReason: 'insufficient_remaining' };
  }

  const computedAllowedPages = computeAllowedSearchPages(
    config.maxPages,
    searchSnapshot.remaining,
    searchSnapshot.resetAtEpochSec,
    config.cronIntervalSeconds,
    config.reserve,
    nowMs
  );
  const allowedPages = pageBudgetOverride === undefined
    ? computedAllowedPages
    : Math.min(computedAllowedPages, Math.max(0, Math.floor(pageBudgetOverride)));

  if (allowedPages <= 0) {
    return { ...baseResult, allowedPages, skippedReason: 'budget_exhausted' };
  }

  const today = formatDateOnly(nowMs);
  const cursor = await getCodeSearchBackfillCursor(env);
  const date = (!cursor || cursor >= today) ? config.startDate : cursor;
  const query = `filename:SKILL.md created:${date}..${date}`;

  const seenFingerprints = new Set<string>();
  let scanned = 0;
  let queued = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= allowedPages; page++) {
    const response = await searchCode(query, {
      page,
      perPage: config.perPage,
      sort: 'indexed',
      order: 'desc',
      // Budget snapshots are refreshed explicitly via /rate_limit.
      // Keep discovery requests themselves write-free for KV cost control.
      ...getGitHubRequestAuthFromEnv(env, { rateLimitMode: 'read_only' }),
      userAgent: 'SkillsCat-Worker/1.0',
    });

    if (!response.ok) {
      if (isGitHubRateLimited(response)) {
        return { scanned, queued, pagesFetched, allowedPages, date, skippedReason: 'search_rate_limited' };
      }
      console.warn(`Code search backfill failed for ${date}: ${response.status}`);
      return { scanned, queued, pagesFetched, allowedPages, date, skippedReason: 'search_failed' };
    }

    const payload = await response.json() as GitHubCodeSearchResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];
    pagesFetched++;

    const outcome = await queueCodeSearchItems(
      env,
      items,
      repoDedupeState,
      seenFingerprints,
      null,
      nowMs
    );
    scanned += outcome.scanned;
    queued += outcome.queued;

    if (items.length < config.perPage) {
      break;
    }

    if (page === allowedPages) {
      // GitHub search 单查询上限 1000 条/10 页,单日 SKILL.md 新增量远达不到;
      // 截断只记日志,游标照常前进。
      console.log(`Code search backfill page budget exhausted on a full page for ${date}; remaining results are not fetched`);
    }
  }

  await setCodeSearchBackfillCursor(env, addDaysToDateOnly(date, 1));

  return { scanned, queued, pagesFetched, allowedPages, date };
}

/**
 * HTML 仓库搜索发现:抓 github.com/search 仓库结果页(零 API 配额),
 * 入队前用 github.com/<owner>/<repo>/raw/HEAD/SKILL.md 校验候选(200 才算通过),
 * 过滤 awesome-list 类仓库。任何抓取/解析失败只记日志跳过,绝不影响其他路径。
 */
async function processHtmlRepoSearchDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  ctx: ExecutionContext | null,
  lockToken: string,
  nowMs: number = Date.now()
): Promise<HtmlSearchDiscoveryResult> {
  const config = getHtmlSearchDiscoveryConfig(env);
  const baseResult: HtmlSearchDiscoveryResult = { scanned: 0, queued: 0, pagesFetched: 0 };

  if (!config.enabled) {
    return { ...baseResult, skippedReason: 'disabled' };
  }

  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...baseResult, skippedReason: 'interval_throttled' };
  }

  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);
  const waitUntil = ctx ? (promise: Promise<unknown>) => ctx.waitUntil(promise) : undefined;
  let scanned = 0;
  let queued = 0;
  let pagesFetched = 0;
  const seenRepos = new Set<string>();

  for (const query of config.queries) {
    for (let page = 1; page <= config.pages; page++) {
      if (!await renewDiscoveryRunLock(env, lockToken)) {
        return { scanned, queued, pagesFetched, skippedReason: 'lock_lost' };
      }

      let results;
      try {
        results = await fetchPublicSkillRepoSearchPage({ query, page, waitUntil });
        pagesFetched++;
      } catch (error) {
        console.warn(
          `HTML repo search discovery failed for query "${query}" page ${page}:`,
          error instanceof PublicRepoSearchError ? `${error.reason} (status=${error.status ?? 'none'})` : error
        );
        continue;
      }

      for (const repo of results) {
        scanned++;

        if (!await renewDiscoveryRunLock(env, lockToken)) {
          return { scanned, queued, pagesFetched, skippedReason: 'lock_lost' };
        }

        const repoIdentity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
        if (seenRepos.has(repoIdentity)) continue;
        seenRepos.add(repoIdentity);
        if (seenRepos.size > config.maxCandidates) {
          return { scanned, queued, pagesFetched, skippedReason: 'candidate_cap_reached' };
        }

        if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, undefined, nowMs)) {
          continue;
        }

        let hasSkillMd = false;
        try {
          hasSkillMd = await checkPublicSkillMdAtHead(repo.owner, repo.name, { waitUntil });
        } catch (error) {
          console.warn(`HTML repo search candidate check failed for ${repo.owner}/${repo.name}:`, error);
          continue;
        }
        if (!hasSkillMd) continue;

        if (!await renewDiscoveryRunLock(env, lockToken)) {
          return { scanned, queued, pagesFetched, skippedReason: 'lock_lost' };
        }

        const message: IndexingMessage = {
          type: 'check_skill',
          repoOwner: repo.owner,
          repoName: repo.name,
          skillPath: undefined,
          discoverySource: 'github-repo-search-html',
        };

        await env.INDEXING_QUEUE.send(message);
        markRepoQueued(repoDedupeState, repo.owner, repo.name, undefined, nowMs, dedupTtlSeconds);
        queued++;
        console.log(`Queued HTML-discovered repo for indexing: ${repo.owner}/${repo.name}`);
      }

      if (results.length === 0) break;
    }
  }

  return { scanned, queued, pagesFetched };
}

function parseDiscoveryRunLockPayload(
  raw: string | null,
  ttlSeconds: number
): DiscoveryRunLockPayload | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<DiscoveryRunLockPayload>;
    const token = typeof parsed.token === 'string' ? parsed.token : null;
    const acquiredAtEpochMs = Number(parsed.acquiredAtEpochMs);
    const expiresAtEpochMs = Number(parsed.expiresAtEpochMs);

    if (
      token
      && Number.isFinite(acquiredAtEpochMs)
      && Number.isFinite(expiresAtEpochMs)
    ) {
      return { token, acquiredAtEpochMs, expiresAtEpochMs };
    }
  } catch {
    const legacyAcquiredAtEpochMs = Number(raw);
    if (Number.isFinite(legacyAcquiredAtEpochMs) && legacyAcquiredAtEpochMs > 0) {
      return {
        token: 'legacy',
        acquiredAtEpochMs: legacyAcquiredAtEpochMs,
        expiresAtEpochMs: legacyAcquiredAtEpochMs + ttlSeconds * 1000,
      };
    }
  }

  return null;
}

async function readDiscoveryRunLock(env: GithubEventsEnv): Promise<DiscoveryRunLockPayload | null> {
  const ttlSeconds = getDiscoveryLockTtlSeconds(env);
  const raw = await getGithubEventsStateStore(env).get(RUN_LOCK_KEY);
  return parseDiscoveryRunLockPayload(raw, ttlSeconds);
}

async function acquireDiscoveryRunLock(env: GithubEventsEnv): Promise<string | null> {
  const existing = await readDiscoveryRunLock(env);
  if (existing && existing.expiresAtEpochMs > Date.now()) {
    return null;
  }

  const ttlSeconds = getDiscoveryLockTtlSeconds(env);
  const acquiredAtEpochMs = Date.now();
  const token = crypto.randomUUID();
  const payload: DiscoveryRunLockPayload = {
    token,
    acquiredAtEpochMs,
    expiresAtEpochMs: acquiredAtEpochMs + ttlSeconds * 1000,
  };

  await getGithubEventsStateStore(env).put(RUN_LOCK_KEY, JSON.stringify(payload), {
    expirationTtl: ttlSeconds,
  });

  const confirmed = await readDiscoveryRunLock(env);
  if (!confirmed || confirmed.token !== token) {
    return null;
  }

  return token;
}

async function hasDiscoveryRunLockOwnership(env: GithubEventsEnv, token: string): Promise<boolean> {
  const current = await readDiscoveryRunLock(env);
  if (!current) return false;
  if (current.token !== token) return false;
  return current.expiresAtEpochMs > Date.now();
}

async function renewDiscoveryRunLock(env: GithubEventsEnv, token: string): Promise<boolean> {
  const current = await readDiscoveryRunLock(env);
  if (!current || current.token !== token || current.expiresAtEpochMs <= Date.now()) {
    return false;
  }

  const ttlSeconds = getDiscoveryLockTtlSeconds(env);
  const now = Date.now();
  if (current.expiresAtEpochMs - now > (ttlSeconds * 1000) / 2) {
    return true;
  }

  const payload: DiscoveryRunLockPayload = {
    token,
    acquiredAtEpochMs: current.acquiredAtEpochMs,
    expiresAtEpochMs: now + ttlSeconds * 1000,
  };
  await getGithubEventsStateStore(env).put(RUN_LOCK_KEY, JSON.stringify(payload), {
    expirationTtl: ttlSeconds,
  });
  const confirmed = await readDiscoveryRunLock(env);
  return Boolean(confirmed && confirmed.token === token && confirmed.expiresAtEpochMs > Date.now());
}

async function releaseDiscoveryRunLock(env: GithubEventsEnv, token: string): Promise<void> {
  const current = await readDiscoveryRunLock(env);
  if (!current || current.token !== token) {
    return;
  }
  await getGithubEventsStateStore(env).delete(RUN_LOCK_KEY);
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: GithubEventsEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    const sharedRateLimitKV = getGitHubRateLimitKVFromEnv(env);
    const runtimeEnv = withGitHubRateLimitKVOverride(
      env,
      isDurableObjectKvStore(sharedRateLimitKV)
        ? createMemoizedDurableObjectKvStore(sharedRateLimitKV)
        : sharedRateLimitKV
    );
    const lockToken = await acquireDiscoveryRunLock(runtimeEnv);
    if (!lockToken) {
      console.log('GitHub Events Worker skipped due to active discovery lock');
      return;
    }

    console.log('GitHub Events Worker triggered at:', new Date().toISOString());

    let repoDedupeState: RepoQueueDedupeState | null = null;
    let nowMs = Date.now();

    try {
      repoDedupeState = await readRepoQueueDedupeState(runtimeEnv, nowMs);

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before discovery start');
        return;
      }

      const restBeforeEvents = await readOrRefreshRateLimitSnapshot(runtimeEnv, 'rest');

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before events processing');
        return;
      }

      const eventsResult = await processEvents(runtimeEnv, restBeforeEvents, repoDedupeState, nowMs);
      const searchBeforeDiscovery = await readGitHubRateLimitBudget(runtimeEnv, 'search', {
        includeStale: true,
      });

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before code search processing');
        return;
      }

      nowMs = Date.now();
      const searchResult = await processCodeSearchDiscovery(runtimeEnv, repoDedupeState, searchBeforeDiscovery, nowMs);

      nowMs = Date.now();
      const backfillSnapshot = searchBeforeDiscovery && searchResult.remainingAfter !== undefined
        ? {
            ...searchBeforeDiscovery,
            remaining: searchResult.remainingAfter,
            // This is a local per-tick budget after subtracting requests made
            // above, so do not refresh it back to the original snapshot.
            updatedAtEpochMs: Date.now(),
            ...(searchResult.resetAtEpochSecAfter === undefined
              ? {}
              : { resetAtEpochSec: searchResult.resetAtEpochSecAfter }),
          }
        : searchBeforeDiscovery;
      const backfillPageBudget = searchResult.skippedReason === 'search_rate_limited'
        ? 0
        : searchResult.skippedReason === 'disabled'
          || searchResult.skippedReason === 'interval_throttled'
          || searchResult.skippedReason === 'missing_rate_limit'
          ? undefined
          : Math.max(0, searchResult.allowedPages - searchResult.pagesFetched);
      const backfillResult = await processCodeSearchBackfill(
        runtimeEnv,
        repoDedupeState,
        backfillSnapshot,
        nowMs,
        backfillPageBudget
      );

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before HTML repo search processing');
        return;
      }

      nowMs = Date.now();
      const htmlResult = await processHtmlRepoSearchDiscovery(runtimeEnv, repoDedupeState, _ctx, lockToken, nowMs);
      console.log(
        `Discovery summary: events_processed=${eventsResult.processed}, events_queued=${eventsResult.queued}, events_unknown_skipped=${eventsResult.unknownSkipped}, events_pages=${eventsResult.pagesFetched}/${eventsResult.allowedPages}, events_skipped=${eventsResult.skippedReason || 'none'}, search_scanned=${searchResult.scanned}, search_queued=${searchResult.queued}, search_pages=${searchResult.pagesFetched}/${searchResult.allowedPages}, search_cursor_stop=${searchResult.stoppedByCursor}, search_skipped=${searchResult.skippedReason || 'none'}, backfill_scanned=${backfillResult.scanned}, backfill_queued=${backfillResult.queued}, backfill_pages=${backfillResult.pagesFetched}/${backfillResult.allowedPages}, backfill_date=${backfillResult.date || 'none'}, backfill_skipped=${backfillResult.skippedReason || 'none'}, html_scanned=${htmlResult.scanned}, html_queued=${htmlResult.queued}, html_pages=${htmlResult.pagesFetched}, html_skipped=${htmlResult.skippedReason || 'none'}, rest_snapshot_remaining=${restBeforeEvents?.remaining ?? 'unknown'}, search_snapshot_remaining=${searchBeforeDiscovery?.remaining ?? 'unknown'}`
      );
    } finally {
      if (repoDedupeState) {
        await persistRepoQueueDedupeState(runtimeEnv, repoDedupeState, Date.now());
      }
      await releaseDiscoveryRunLock(runtimeEnv, lockToken);
    }
  },
};
