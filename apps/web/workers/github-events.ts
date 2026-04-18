/**
 * GitHub Events Worker
 *
 * 轮询 GitHub Events API，并在预算允许时使用 Code Search 增强发现
 * 通过 Cron Trigger 默认每 5 分钟执行一次
 */

import type { GithubEventsEnv, GitHubEvent, IndexingMessage } from './shared/types';
import { getGitHubRequestAuthFromEnv } from '../src/lib/server/github-client/env';
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

const DEFAULT_EVENTS_PER_PAGE = 100;
const DEFAULT_EVENTS_PAGES = 1;
const DEFAULT_EVENTS_MIN_REST_REMAINING = 1000;
const DEFAULT_EVENTS_REST_RESERVE = 300;
const DEFAULT_SEARCH_DISCOVERY_QUERY = 'filename:SKILL.md';
const DEFAULT_SEARCH_DISCOVERY_PAGES = 1;
const DEFAULT_SEARCH_DISCOVERY_PER_PAGE = 100;
const DEFAULT_SEARCH_DISCOVERY_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS = 5 * 60;
const DEFAULT_MIN_REST_REMAINING = 1000;
const DEFAULT_REST_RESERVE = 300;
const DEFAULT_DISCOVERY_LOCK_TTL_SECONDS = 240;

const REPO_QUEUE_DEDUP_TTL_SECONDS = 5 * 60;
const SEARCH_PROCESSED_TTL_SECONDS = 7 * 24 * 60 * 60;
const RATE_LIMIT_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

const RUN_LOCK_KEY = 'github-discovery:run-lock';
const CODE_SEARCH_CURSOR_KEY = 'github-events:code-search:last-head';
const EVENT_REPLAY_STATE_KEY = 'github-events:event-replay-state';

interface SearchDiscoveryResult {
  scanned: number;
  queued: number;
  pagesFetched: number;
  allowedPages: number;
  stoppedByCursor: boolean;
  skippedReason?: string;
}

interface EventsDiscoveryResult {
  processed: number;
  queued: number;
  pagesFetched: number;
  allowedPages: number;
  skippedReason?: string;
}

interface RepoIdentity {
  owner: string;
  name: string;
}

type QueuedRepoSet = Set<string>;

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
  return parsePositiveInt(env.GITHUB_EVENTS_PER_PAGE, DEFAULT_EVENTS_PER_PAGE);
}

function getEventsDiscoveryConfig(env: GithubEventsEnv): {
  pages: number;
  perPage: number;
  cronIntervalSeconds: number;
  minRestRemaining: number;
  restReserve: number;
} {
  return {
    pages: parsePositiveInt(env.GITHUB_EVENTS_PAGES, DEFAULT_EVENTS_PAGES),
    perPage: getEventsPerPage(env),
    cronIntervalSeconds: parsePositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS
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
    pages: parsePositiveInt(env.GITHUB_SEARCH_DISCOVERY_PAGES, DEFAULT_SEARCH_DISCOVERY_PAGES),
    perPage: parsePositiveInt(env.GITHUB_SEARCH_DISCOVERY_PER_PAGE, DEFAULT_SEARCH_DISCOVERY_PER_PAGE),
    intervalSeconds: parsePositiveInt(
      env.GITHUB_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      DEFAULT_SEARCH_DISCOVERY_INTERVAL_SECONDS
    ),
    cronIntervalSeconds: parsePositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS
    ),
    minRestRemaining: parsePositiveInt(env.GITHUB_DISCOVERY_MIN_REST_REMAINING, DEFAULT_MIN_REST_REMAINING),
    restReserve: parsePositiveInt(env.GITHUB_DISCOVERY_REST_RESERVE, DEFAULT_REST_RESERVE),
  };
}

function getDiscoveryLockTtlSeconds(env: GithubEventsEnv): number {
  return parsePositiveInt(env.GITHUB_DISCOVERY_LOCK_TTL_SECONDS, DEFAULT_DISCOVERY_LOCK_TTL_SECONDS);
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
    discoverySource: 'github-events',
  };
}

/**
 * 获取上次处理的事件 ID
 */
async function getLastProcessedEventId(env: GithubEventsEnv): Promise<string | null> {
  return env.KV.get('github-events:last-event-id');
}

/**
 * 保存最后处理的事件 ID
 */
async function setLastProcessedEventId(env: GithubEventsEnv, eventId: string): Promise<void> {
  await env.KV.put('github-events:last-event-id', eventId, {
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
  const raw = await env.KV.get(EVENT_REPLAY_STATE_KEY);
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
      await env.KV.delete(EVENT_REPLAY_STATE_KEY);
      return new Set();
    }

    return new Set(processedPushEventIds);
  } catch {
    await env.KV.delete(EVENT_REPLAY_STATE_KEY);
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

  await env.KV.put(EVENT_REPLAY_STATE_KEY, JSON.stringify(payload), {
    expirationTtl: 24 * 60 * 60,
  });
}

async function clearEventReplayState(env: GithubEventsEnv): Promise<void> {
  await env.KV.delete(EVENT_REPLAY_STATE_KEY);
}

function getRepoQueuedKey(owner: string, name: string, skillPath?: string): string {
  return `github-events:repo-queued:${buildRepoQueuedDedupIdentity(owner, name, skillPath)}`;
}

/**
 * Check if a repository path has been queued recently.
 * This suppresses bursts of duplicate queue messages.
 */
async function wasRepoQueuedRecently(
  env: GithubEventsEnv,
  owner: string,
  name: string,
  skillPath?: string
): Promise<boolean> {
  return (await env.KV.get(getRepoQueuedKey(owner, name, skillPath))) !== null;
}

/**
 * Mark a repository path as recently queued.
 */
async function markRepoQueued(
  env: GithubEventsEnv,
  owner: string,
  name: string,
  skillPath?: string
): Promise<void> {
  await env.KV.put(getRepoQueuedKey(owner, name, skillPath), '1', {
    expirationTtl: REPO_QUEUE_DEDUP_TTL_SECONDS,
  });
}

function getSearchProcessedKey(fingerprint: string): string {
  return `github-events:search-processed:${fingerprint}`;
}

async function isSearchFingerprintProcessed(env: GithubEventsEnv, fingerprint: string): Promise<boolean> {
  return (await env.KV.get(getSearchProcessedKey(fingerprint))) !== null;
}

async function markSearchFingerprintProcessed(env: GithubEventsEnv, fingerprint: string): Promise<void> {
  await env.KV.put(getSearchProcessedKey(fingerprint), '1', {
    expirationTtl: SEARCH_PROCESSED_TTL_SECONDS,
  });
}

async function getCodeSearchHeadCursor(env: GithubEventsEnv): Promise<string | null> {
  return env.KV.get(CODE_SEARCH_CURSOR_KEY);
}

async function setCodeSearchHeadCursor(env: GithubEventsEnv, fingerprint: string): Promise<void> {
  await env.KV.put(CODE_SEARCH_CURSOR_KEY, fingerprint, {
    expirationTtl: 86400 * 30,
  });
}

async function readGitHubRateLimitBudget(
  env: GithubEventsEnv,
  bucket: 'rest' | 'graphql',
  options: { maxAgeMs?: number; includeStale?: boolean } = {}
): Promise<GitHubRateLimitSnapshot | null> {
  const tokenIds = await resolveGitHubTokenIds(getGitHubTokenInputFromEnv(env));
  return readAggregatedRateLimitSnapshot(bucket, {
    kv: env.KV,
    tokenIds,
    maxAgeMs: options.maxAgeMs,
    includeStale: options.includeStale,
  });
}

async function readOrRefreshRestRateLimitSnapshot(env: GithubEventsEnv): Promise<GitHubRateLimitSnapshot | null> {
  let snapshot = await readGitHubRateLimitBudget(env, 'rest', {
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
        rateLimitKV: env.KV,
      });

      if (!response.ok) {
        console.warn(`Failed to refresh GitHub rate limit snapshot for token ${candidate.id}: ${response.status}`);
      }
    }
  } catch (error) {
    console.warn('Failed to refresh GitHub rate limit snapshot due to network error:', error);
  }

  snapshot = await readGitHubRateLimitBudget(env, 'rest', {
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
  queuedRepoKeysInRun: QueuedRepoSet
): Promise<EventsDiscoveryResult> {
  let processed = 0;
  let queued = 0;
  let pagesFetched = 0;

  const config = getEventsDiscoveryConfig(env);

  if (!restSnapshot) {
    return {
      processed,
      queued,
      pagesFetched,
      allowedPages: 0,
      skippedReason: 'missing_rate_limit',
    };
  }

  if (restSnapshot.remaining < config.minRestRemaining) {
    return {
      processed,
      queued,
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

    for (let page = 1; page <= allowedPages; page++) {
      const fetchResult = await fetchGitHubEvents(env, page, config.perPage);
      if (fetchResult.rateLimited) {
        if (hadReplayState) {
          await clearEventReplayState(env);
        }
        await persistProcessedEventCursor(env, lastEventId, newestEventId);
        return {
          processed,
          queued,
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
        if (message) {
          const repoQueuedIdentity = buildRepoQueuedDedupIdentity(message.repoOwner, message.repoName);
          if (queuedRepoKeysInRun.has(repoQueuedIdentity)) {
            replayedPushEventIds.add(event.id);
            continue;
          }

          if (await wasRepoQueuedRecently(env, message.repoOwner, message.repoName)) {
            queuedRepoKeysInRun.add(repoQueuedIdentity);
            replayedPushEventIds.add(event.id);
            continue;
          }

          await env.INDEXING_QUEUE.send(message);
          await markRepoQueued(env, message.repoOwner, message.repoName);
          queuedRepoKeysInRun.add(repoQueuedIdentity);
          queued++;
          console.log(`Queued repo for indexing: ${message.repoOwner}/${message.repoName}`);
        }

        replayedPushEventIds.add(event.id);
      }

      if (reachedLastProcessed || events.length < config.perPage) {
        break;
      }
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
    pagesFetched,
    allowedPages,
  };
}

async function processCodeSearchDiscovery(
  env: GithubEventsEnv,
  queuedRepoKeysInRun: QueuedRepoSet,
  initialRestSnapshot?: GitHubRateLimitSnapshot | null,
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

  const restSnapshot = (!initialRestSnapshot || isRateLimitSnapshotStale(initialRestSnapshot, RATE_LIMIT_SNAPSHOT_MAX_AGE_MS))
    ? await readOrRefreshRestRateLimitSnapshot(env)
    : initialRestSnapshot;
  if (!restSnapshot) {
    return {
      ...baseResult,
      skippedReason: 'missing_rate_limit',
    };
  }

  if (restSnapshot.remaining < config.minRestRemaining) {
    return {
      ...baseResult,
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
      ...baseResult,
      allowedPages,
      skippedReason: 'budget_exhausted',
    };
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
        return {
          scanned,
          queued,
          pagesFetched,
          allowedPages,
          stoppedByCursor,
          skippedReason: 'search_rate_limited',
        };
      }
      throw new Error(`Failed to fetch GitHub code search: ${response.status}`);
    }

    const payload = await response.json() as GitHubCodeSearchResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];

    pagesFetched++;
    if (page === 1 && items.length > 0) {
      nextHeadCursor = buildSearchFingerprint(items[0]);
    }

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

      if (await isSearchFingerprintProcessed(env, fingerprint)) {
        continue;
      }

      const repo = parseRepoFullName(item.repository?.full_name);
      if (!repo) {
        await markSearchFingerprintProcessed(env, fingerprint);
        continue;
      }

      const skillPath = getSkillPathFromSkillMdPath(item.path);
      const repoQueuedIdentity = buildRepoQueuedDedupIdentity(repo.owner, repo.name, skillPath);
      if (queuedRepoKeysInRun.has(repoQueuedIdentity)) {
        await markSearchFingerprintProcessed(env, fingerprint);
        continue;
      }

      if (await wasRepoQueuedRecently(env, repo.owner, repo.name, skillPath)) {
        queuedRepoKeysInRun.add(repoQueuedIdentity);
        await markSearchFingerprintProcessed(env, fingerprint);
        continue;
      }

      const message: IndexingMessage = {
        type: 'check_skill',
        repoOwner: repo.owner,
        repoName: repo.name,
        skillPath,
        discoverySource: 'github-code-search',
        discoveryFingerprint: fingerprint,
      };

      await env.INDEXING_QUEUE.send(message);
      await markRepoQueued(env, repo.owner, repo.name, skillPath);
      queuedRepoKeysInRun.add(repoQueuedIdentity);
      await markSearchFingerprintProcessed(env, fingerprint);
      queued++;
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

  return {
    scanned,
    queued,
    pagesFetched,
    allowedPages,
    stoppedByCursor,
  };
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
  const raw = await env.KV.get(RUN_LOCK_KEY);
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

  await env.KV.put(RUN_LOCK_KEY, JSON.stringify(payload), {
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

async function releaseDiscoveryRunLock(env: GithubEventsEnv, token: string): Promise<void> {
  const current = await readDiscoveryRunLock(env);
  if (!current || current.token !== token) {
    return;
  }
  await env.KV.delete(RUN_LOCK_KEY);
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: GithubEventsEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    const lockToken = await acquireDiscoveryRunLock(env);
    if (!lockToken) {
      console.log('GitHub Events Worker skipped due to active discovery lock');
      return;
    }

    console.log('GitHub Events Worker triggered at:', new Date().toISOString());

    try {
      const nowMs = Date.now();
      const queuedRepoKeysInRun: QueuedRepoSet = new Set();

      if (!await hasDiscoveryRunLockOwnership(env, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before discovery start');
        return;
      }

      const restBeforeEvents = await readOrRefreshRestRateLimitSnapshot(env);

      if (!await hasDiscoveryRunLockOwnership(env, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before events processing');
        return;
      }

      const eventsResult = await processEvents(env, restBeforeEvents, queuedRepoKeysInRun);
      const restAfterEvents = await readGitHubRateLimitBudget(env, 'rest', {
        includeStale: true,
      });

      if (!await hasDiscoveryRunLockOwnership(env, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before code search processing');
        return;
      }

      const searchResult = await processCodeSearchDiscovery(env, queuedRepoKeysInRun, restAfterEvents, nowMs);
      const restSnapshot = await readGitHubRateLimitBudget(env, 'rest', { includeStale: true });
      const graphqlSnapshot = await readGitHubRateLimitBudget(env, 'graphql', { includeStale: true });

      console.log(
        `Discovery summary: events_processed=${eventsResult.processed}, events_queued=${eventsResult.queued}, events_pages=${eventsResult.pagesFetched}/${eventsResult.allowedPages}, events_skipped=${eventsResult.skippedReason || 'none'}, search_scanned=${searchResult.scanned}, search_queued=${searchResult.queued}, search_pages=${searchResult.pagesFetched}/${searchResult.allowedPages}, search_cursor_stop=${searchResult.stoppedByCursor}, search_skipped=${searchResult.skippedReason || 'none'}, rest_remaining=${restSnapshot?.remaining ?? 'unknown'}, graphql_remaining=${graphqlSnapshot?.remaining ?? 'unknown'}`
      );
    } finally {
      await releaseDiscoveryRunLock(env, lockToken);
    }
  },
};
