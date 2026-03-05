import type { GitHubEndpointId } from './endpoints';

export type GitHubRateLimitBucket = 'rest' | 'graphql';

export interface GitHubRateLimitSnapshot {
  bucket: GitHubRateLimitBucket;
  limit: number;
  remaining: number;
  used: number;
  resetAtEpochSec: number;
  updatedAtEpochMs: number;
  source: 'headers' | 'rate_limit_api';
  endpointId?: string;
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

function getBucketKey(bucket: GitHubRateLimitBucket, keyPrefix: string): string {
  return `${keyPrefix}:${bucket}`;
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

export function getRateLimitKvKey(
  bucket: GitHubRateLimitBucket,
  keyPrefix: string = DEFAULT_RATE_LIMIT_KEY_PREFIX
): string {
  return getBucketKey(bucket, keyPrefix);
}

export async function recordRateLimitFromHeaders(
  headers: Headers,
  bucket: GitHubRateLimitBucket,
  options: GitHubRateLimitStorageOptions & {
    endpointId?: GitHubEndpointId | string;
    source?: GitHubRateLimitSnapshot['source'];
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
  };

  await kv.put(
    getBucketKey(bucket, options.keyPrefix ?? DEFAULT_RATE_LIMIT_KEY_PREFIX),
    JSON.stringify(snapshot),
    { expirationTtl: computeSnapshotTtlSeconds(snapshot.resetAtEpochSec) }
  );

  return snapshot;
}

export async function recordRateLimitFromRateLimitBody(
  body: unknown,
  options: GitHubRateLimitStorageOptions & {
    endpointId?: GitHubEndpointId | string;
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
    };
    await kv.put(getBucketKey('rest', keyPrefix), JSON.stringify(rest), {
      expirationTtl: computeSnapshotTtlSeconds(rest.resetAtEpochSec),
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
    };
    await kv.put(getBucketKey('graphql', keyPrefix), JSON.stringify(graphql), {
      expirationTtl: computeSnapshotTtlSeconds(graphql.resetAtEpochSec),
    });
  }

  return { rest, graphql };
}

export async function readRateLimitSnapshot(
  bucket: GitHubRateLimitBucket,
  options: GitHubRateLimitStorageOptions = {}
): Promise<GitHubRateLimitSnapshot | null> {
  const kv = options.kv;
  if (!kv) return null;

  const raw = await kv.get(getBucketKey(bucket, options.keyPrefix ?? DEFAULT_RATE_LIMIT_KEY_PREFIX));
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
      source: parsed.source === 'rate_limit_api' ? 'rate_limit_api' : 'headers',
      endpointId: parsed.endpointId,
    };
  } catch {
    return null;
  }
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
