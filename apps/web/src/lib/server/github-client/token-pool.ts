import {
  isRateLimitSnapshotStale,
  readRateLimitSnapshot,
  type GitHubRateLimitBucket,
  type GitHubRateLimitSnapshot,
} from './rate-limit-kv';

const TOKEN_SPLIT_PATTERN = /[\n,]+/;
const TOKEN_HEALTH_MAX_AGE_MS = 5 * 60 * 1000;

const tokenIdCache = new Map<string, Promise<string>>();

export interface GitHubTokenEnv {
  GITHUB_TOKEN?: string;
  GITHUB_TOKENS?: string;
  KV?: KVNamespace;
}

export type GitHubTokenInput = string | string[] | undefined | null;

export interface GitHubTokenCandidate {
  id: string;
  value: string;
  index: number;
}

function dedupeTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }

  return result;
}

function parseJsonTokenArray(raw: string): string[] | null {
  if (!raw.startsWith('[')) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;

    return parsed
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function parseGitHubTokenInput(input: GitHubTokenInput): string[] {
  if (Array.isArray(input)) {
    return dedupeTokens(
      input
        .map((value) => value.trim())
        .filter(Boolean)
    );
  }

  const raw = (input || '').trim();
  if (!raw) return [];

  const jsonArray = parseJsonTokenArray(raw);
  if (jsonArray) {
    return dedupeTokens(jsonArray);
  }

  return dedupeTokens(
    raw
      .split(TOKEN_SPLIT_PATTERN)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function getGitHubTokenInputFromEnv(env: GitHubTokenEnv | null | undefined): string | undefined {
  const pooled = env?.GITHUB_TOKENS?.trim();
  if (pooled) return pooled;

  const single = env?.GITHUB_TOKEN?.trim();
  return single || undefined;
}

export function hasGitHubTokenConfigured(env: GitHubTokenEnv | null | undefined): boolean {
  return parseGitHubTokenInput(getGitHubTokenInputFromEnv(env)).length > 0;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  return [...view].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getGitHubTokenId(token: string): Promise<string> {
  const existing = tokenIdCache.get(token);
  if (existing) {
    return existing;
  }

  const pending = sha256Hex(token).then((digest) => digest.slice(0, 24));
  tokenIdCache.set(token, pending);
  return pending;
}

export async function resolveGitHubTokenCandidates(input: GitHubTokenInput): Promise<GitHubTokenCandidate[]> {
  const tokens = parseGitHubTokenInput(input);
  return Promise.all(tokens.map(async (token, index) => ({
    id: await getGitHubTokenId(token),
    value: token,
    index,
  })));
}

export async function resolveGitHubTokenIds(input: GitHubTokenInput): Promise<string[]> {
  const candidates = await resolveGitHubTokenCandidates(input);
  return candidates.map((candidate) => candidate.id);
}

interface TokenOrderEntry {
  candidate: GitHubTokenCandidate;
  snapshot: GitHubRateLimitSnapshot | null;
  exhausted: boolean;
  fresh: boolean;
}

function compareTokenEntries(left: TokenOrderEntry, right: TokenOrderEntry): number {
  if (left.exhausted !== right.exhausted) {
    return left.exhausted ? 1 : -1;
  }

  if (left.fresh !== right.fresh) {
    return left.fresh ? -1 : 1;
  }

  if (left.fresh && right.fresh && left.snapshot && right.snapshot) {
    if (left.snapshot.remaining !== right.snapshot.remaining) {
      return right.snapshot.remaining - left.snapshot.remaining;
    }

    if (left.snapshot.resetAtEpochSec !== right.snapshot.resetAtEpochSec) {
      return left.snapshot.resetAtEpochSec - right.snapshot.resetAtEpochSec;
    }
  }

  return left.candidate.index - right.candidate.index;
}

export async function orderGitHubTokenCandidates(
  candidates: GitHubTokenCandidate[],
  options: {
    bucket: GitHubRateLimitBucket;
    kv?: KVNamespace;
    keyPrefix?: string;
    maxAgeMs?: number;
    nowMs?: number;
  }
): Promise<GitHubTokenCandidate[]> {
  if (candidates.length <= 1 || !options.kv) {
    return candidates;
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? TOKEN_HEALTH_MAX_AGE_MS;

  const entries = await Promise.all(candidates.map(async (candidate) => {
    const snapshot = await readRateLimitSnapshot(options.bucket, {
      kv: options.kv,
      keyPrefix: options.keyPrefix,
      tokenId: candidate.id,
    });

    return {
      candidate,
      snapshot,
      fresh: !!snapshot && !isRateLimitSnapshotStale(snapshot, maxAgeMs, nowMs),
      exhausted: !!snapshot
        && snapshot.resetAtEpochSec * 1000 > nowMs
        && snapshot.remaining <= 0,
    } satisfies TokenOrderEntry;
  }));

  entries.sort(compareTokenEntries);
  return entries.map((entry) => entry.candidate);
}
