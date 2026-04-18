import type { GitHubEndpointId } from './endpoints';

export type GitHubRateLimitBucket = 'rest' | 'graphql';

export interface GitHubRateLimitSnapshot {
  bucket: GitHubRateLimitBucket;
  limit: number;
  remaining: number;
  used: number;
  resetAtEpochSec: number;
  updatedAtEpochMs: number;
  source: 'headers' | 'rate_limit_api' | 'aggregate';
  endpointId?: string;
  tokenId?: string;
  tokenCount?: number;
  knownTokenCount?: number;
}

export interface GitHubRateLimitStorageOptions {
  kv?: KVNamespace;
  keyPrefix?: string;
}

interface RateLimitResourcePayload {
  limit?: number;
  remaining?: number;
  used?: number;
  reset?: number;
}

interface RateLimitApiBody {
  resources?: {
    core?: RateLimitResourcePayload;
    graphql?: RateLimitResourcePayload;
    [key: string]: RateLimitResourcePayload | undefined;
  };
  rate?: RateLimitResourcePayload;
}

const DEFAULT_RATE_LIMIT_KEY_PREFIX = 'github-rate-limit';
const SNAPSHOT_NOOP_WRITE_WINDOW_MS = 60_000;

function getBucketKey(bucket: GitHubRateLimitBucket, keyPrefix: string, tokenId?: string): string {
  return tokenId
    ? `${keyPrefix}:token:${tokenId}:${bucket}`
    : `${keyPrefix}:${bucket}`;
}

function parseFiniteNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeRateLimitResource(
  payload: RateLimitResourcePayload | null | undefined
): { limit: number; remaining: number; used: number; resetAtEpochSec: number } | null {
  if (!payload) return null;

  const limit = Number(payload.limit);
  const remaining = Number(payload.remaining);
  const used = Number(payload.used);
  const reset = Number(payload.reset);

  if (![limit, remaining, used, reset].every((value) => Number.isFinite(value))) {
    return null;
  }

  return {
    limit,
    remaining,
    used,
    resetAtEpochSec: reset,
  };
}

function computeSnapshotTtlSeconds(resetAtEpochSec: number): number {
  const nowEpochSec = Math.floor(Date.now() / 1000);
  const untilReset = Math.max(0, resetAtEpochSec - nowEpochSec);
  // Keep a short grace period after reset to allow stale fallback diagnostics.
  return Math.max(60, untilReset + 600);
}

function snapshotsEquivalent(
  left: GitHubRateLimitSnapshot,
  right: GitHubRateLimitSnapshot
): boolean {
  return left.bucket === right.bucket
    && left.limit === right.limit
    && left.remaining === right.remaining
    && left.used === right.used
    && left.resetAtEpochSec === right.resetAtEpochSec
    && left.source === right.source
    && left.endpointId === right.endpointId
    && left.tokenId === right.tokenId;
}

async function persistSnapshotIfNeeded(
  snapshot: GitHubRateLimitSnapshot,
  options: GitHubRateLimitStorageOptions & { tokenId?: string }
): Promise<GitHubRateLimitSnapshot> {
  const kv = options.kv;
  if (!kv) {
    return snapshot;
  }

  const existing = await readRateLimitSnapshot(snapshot.bucket, {
    kv,
    keyPrefix: options.keyPrefix,
    tokenId: options.tokenId,
  });

  if (
    existing
    && snapshotsEquivalent(existing, snapshot)
    && snapshot.updatedAtEpochMs - existing.updatedAtEpochMs < SNAPSHOT_NOOP_WRITE_WINDOW_MS
  ) {
    return existing;
  }

  await kv.put(
    getBucketKey(snapshot.bucket, options.keyPrefix ?? DEFAULT_RATE_LIMIT_KEY_PREFIX, options.tokenId),
    JSON.stringify(snapshot),
    { expirationTtl: computeSnapshotTtlSeconds(snapshot.resetAtEpochSec) }
  );

  return snapshot;
}

export function getRateLimitKvKey(
  bucket: GitHubRateLimitBucket,
  keyPrefix: string = DEFAULT_RATE_LIMIT_KEY_PREFIX,
  options: { tokenId?: string } = {}
): string {
  return getBucketKey(bucket, keyPrefix, options.tokenId);
}

export async function recordRateLimitFromHeaders(
  headers: Headers,
  bucket: GitHubRateLimitBucket,
  options: GitHubRateLimitStorageOptions & {
    endpointId?: GitHubEndpointId | string;
    source?: GitHubRateLimitSnapshot['source'];
    tokenId?: string;
  } = {}
): Promise<GitHubRateLimitSnapshot | null> {
  const kv = options.kv;
  if (!kv) return null;

  const limit = parseFiniteNumber(headers.get('x-ratelimit-limit'));
  const remaining = parseFiniteNumber(headers.get('x-ratelimit-remaining'));
  const used = parseFiniteNumber(headers.get('x-ratelimit-used'));
  const resetAtEpochSec = parseFiniteNumber(headers.get('x-ratelimit-reset'));

  if (limit === null || remaining === null || used === null || resetAtEpochSec === null) {
    return null;
  }

  const snapshot: GitHubRateLimitSnapshot = {
    bucket,
    limit,
    remaining,
    used,
    resetAtEpochSec,
    updatedAtEpochMs: Date.now(),
    source: options.source ?? 'headers',
    endpointId: options.endpointId,
    tokenId: options.tokenId,
  };

  return persistSnapshotIfNeeded(snapshot, options);
}

export async function recordRateLimitFromRateLimitBody(
  body: unknown,
  options: GitHubRateLimitStorageOptions & {
    endpointId?: GitHubEndpointId | string;
    tokenId?: string;
  } = {}
): Promise<{ rest: GitHubRateLimitSnapshot | null; graphql: GitHubRateLimitSnapshot | null }> {
  const kv = options.kv;
  if (!kv) {
    return { rest: null, graphql: null };
  }

  const payload = (body || {}) as RateLimitApiBody;
  const restResource = normalizeRateLimitResource(payload.resources?.core || payload.rate);
  const graphqlResource = normalizeRateLimitResource(payload.resources?.graphql);
  const keyPrefix = options.keyPrefix ?? DEFAULT_RATE_LIMIT_KEY_PREFIX;
  const now = Date.now();

  let rest: GitHubRateLimitSnapshot | null = null;
  if (restResource) {
    rest = {
      bucket: 'rest',
      ...restResource,
      updatedAtEpochMs: now,
      source: 'rate_limit_api',
      endpointId: options.endpointId,
      tokenId: options.tokenId,
    };
    rest = await persistSnapshotIfNeeded(rest, {
      kv,
      keyPrefix,
      tokenId: options.tokenId,
    });
  }

  let graphql: GitHubRateLimitSnapshot | null = null;
  if (graphqlResource) {
    graphql = {
      bucket: 'graphql',
      ...graphqlResource,
      updatedAtEpochMs: now,
      source: 'rate_limit_api',
      endpointId: options.endpointId,
      tokenId: options.tokenId,
    };
    graphql = await persistSnapshotIfNeeded(graphql, {
      kv,
      keyPrefix,
      tokenId: options.tokenId,
    });
  }

  return { rest, graphql };
}

export async function readRateLimitSnapshot(
  bucket: GitHubRateLimitBucket,
  options: GitHubRateLimitStorageOptions & { tokenId?: string } = {}
): Promise<GitHubRateLimitSnapshot | null> {
  const kv = options.kv;
  if (!kv) return null;

  const raw = await kv.get(getBucketKey(bucket, options.keyPrefix ?? DEFAULT_RATE_LIMIT_KEY_PREFIX, options.tokenId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<GitHubRateLimitSnapshot>;
    if (!parsed || parsed.bucket !== bucket) return null;

    const limit = Number(parsed.limit);
    const remaining = Number(parsed.remaining);
    const used = Number(parsed.used);
    const resetAtEpochSec = Number(parsed.resetAtEpochSec);
    const updatedAtEpochMs = Number(parsed.updatedAtEpochMs);

    const requiredNumbers = [limit, remaining, used, resetAtEpochSec, updatedAtEpochMs];
    if (!requiredNumbers.every((value) => Number.isFinite(value))) {
      return null;
    }

    return {
      bucket,
      limit,
      remaining,
      used,
      resetAtEpochSec,
      updatedAtEpochMs,
      source: parsed.source === 'rate_limit_api'
        ? 'rate_limit_api'
        : parsed.source === 'aggregate'
          ? 'aggregate'
          : 'headers',
      endpointId: parsed.endpointId,
      tokenId: typeof parsed.tokenId === 'string' ? parsed.tokenId : undefined,
      tokenCount: Number.isFinite(Number(parsed.tokenCount)) ? Number(parsed.tokenCount) : undefined,
      knownTokenCount: Number.isFinite(Number(parsed.knownTokenCount)) ? Number(parsed.knownTokenCount) : undefined,
    };
  } catch {
    return null;
  }
}

export function aggregateRateLimitSnapshots(
  bucket: GitHubRateLimitBucket,
  snapshots: GitHubRateLimitSnapshot[],
  options: { tokenCount?: number } = {}
): GitHubRateLimitSnapshot | null {
  const valid = snapshots.filter((snapshot) => snapshot.bucket === bucket);
  if (valid.length === 0) {
    return null;
  }

  return {
    bucket,
    limit: valid.reduce((sum, snapshot) => sum + snapshot.limit, 0),
    remaining: valid.reduce((sum, snapshot) => sum + snapshot.remaining, 0),
    used: valid.reduce((sum, snapshot) => sum + snapshot.used, 0),
    resetAtEpochSec: valid.reduce((max, snapshot) => Math.max(max, snapshot.resetAtEpochSec), 0),
    updatedAtEpochMs: valid.reduce((min, snapshot) => Math.min(min, snapshot.updatedAtEpochMs), Number.POSITIVE_INFINITY),
    source: 'aggregate',
    endpointId: 'aggregate',
    tokenCount: options.tokenCount ?? valid.length,
    knownTokenCount: valid.length,
  };
}

export async function readAggregatedRateLimitSnapshot(
  bucket: GitHubRateLimitBucket,
  options: GitHubRateLimitStorageOptions & {
    tokenIds?: string[];
    maxAgeMs?: number;
    includeStale?: boolean;
    nowMs?: number;
  } = {}
): Promise<GitHubRateLimitSnapshot | null> {
  const kv = options.kv;
  if (!kv) return null;

  const tokenIds = (options.tokenIds || []).filter(Boolean);
  if (tokenIds.length === 0) {
    return readRateLimitSnapshot(bucket, {
      kv,
      keyPrefix: options.keyPrefix,
    });
  }

  const nowMs = options.nowMs ?? Date.now();
  const snapshots = (await Promise.all(tokenIds.map((tokenId) => readRateLimitSnapshot(bucket, {
    kv,
    keyPrefix: options.keyPrefix,
    tokenId,
  }))))
    .filter((snapshot): snapshot is GitHubRateLimitSnapshot => Boolean(snapshot))
    .filter((snapshot) => snapshot.resetAtEpochSec * 1000 > nowMs)
    .filter((snapshot) => {
      if (options.includeStale || options.maxAgeMs === undefined) {
        return true;
      }

      return !isRateLimitSnapshotStale(snapshot, options.maxAgeMs, nowMs);
    });

  if (snapshots.length === 0) {
    if (tokenIds.length === 1) {
      return readRateLimitSnapshot(bucket, {
        kv,
        keyPrefix: options.keyPrefix,
      });
    }

    return null;
  }

  return aggregateRateLimitSnapshots(bucket, snapshots, {
    tokenCount: tokenIds.length,
  });
}

export function isRateLimitSnapshotStale(
  snapshot: GitHubRateLimitSnapshot | null,
  maxAgeMs: number,
  nowMs: number = Date.now()
): boolean {
  if (!snapshot) return true;
  if (snapshot.resetAtEpochSec * 1000 <= nowMs) return true;
  return snapshot.updatedAtEpochMs + maxAgeMs <= nowMs;
}
