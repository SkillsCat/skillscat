import type { GitHubRequestOptions } from './request';

export const DEFAULT_API_VERSION = '2022-11-28';
export const DEFAULT_USER_AGENT = 'SkillsCat/1.0';
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_DELAY_MS = 30_000;
export const DEFAULT_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface RawGitHubRequestOptions extends GitHubRequestOptions {
  retryRateLimit?: boolean;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function parseRetryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return asSeconds * 1000;
    }

    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, asDate - Date.now());
    }
  }

  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const epochSeconds = Number(reset);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return Math.max(0, epochSeconds * 1000 - Date.now());
    }
  }

  return null;
}

export function parseRetryAfterSeconds(headers: Headers): number | null {
  const ms = parseRetryAfterMs(headers);
  return ms === null ? null : Math.max(0, Math.ceil(ms / 1000));
}

export function isGitHubRateLimitResponse(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;

  const remaining = response.headers.get('x-ratelimit-remaining');
  if (remaining === '0') return true;

  return response.headers.has('retry-after');
}

function getBackoffDelayMs(attempt: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, 500 * (2 ** attempt));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxDelayMs, exponential + jitter);
}

function shouldRetryResponse(
  response: Response,
  retryableStatuses: Set<number>,
  retryRateLimit: boolean
): boolean {
  if (isGitHubRateLimitResponse(response)) {
    return retryRateLimit;
  }

  return retryableStatuses.has(response.status);
}

export function getUrlHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isGitHubDomain(host: string | null): boolean {
  if (!host) return false;
  return host === 'github.com'
    || host.endsWith('.github.com')
    || host === 'githubusercontent.com'
    || host.endsWith('.githubusercontent.com');
}

export function isGitHubApiHost(host: string | null): boolean {
  return host === 'api.github.com';
}

export function buildGitHubRequestHeaders(
  url: string,
  options: Pick<RawGitHubRequestOptions, 'token' | 'headers' | 'apiVersion' | 'userAgent'>
): Headers {
  const host = getUrlHost(url);
  const githubDomain = isGitHubDomain(host);
  const isApiHost = isGitHubApiHost(host);

  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json');
  if (isApiHost && (options.apiVersion ?? DEFAULT_API_VERSION) && !headers.has('X-GitHub-Api-Version')) {
    headers.set('X-GitHub-Api-Version', options.apiVersion ?? DEFAULT_API_VERSION);
  }
  if (!headers.has('User-Agent')) headers.set('User-Agent', options.userAgent ?? DEFAULT_USER_AGENT);
  if (githubDomain && options.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  return headers;
}

/**
 * Low-level GitHub request with retries and header injection only.
 * No cache / fallback logic here.
 */
export async function rawGitHubRequest(
  url: string,
  options: RawGitHubRequestOptions = {}
): Promise<Response> {
  const {
    token,
    headers: extraHeaders,
    apiVersion = DEFAULT_API_VERSION,
    userAgent = DEFAULT_USER_AGENT,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryableStatuses,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    retryRateLimit = true,
    cache: _cache,
    graphqlFallback: _graphqlFallback,
    endpointId: _endpointId,
    cacheTtlSeconds: _cacheTtlSeconds,
    viewerScoped: _viewerScoped,
    rateLimitKV: _rateLimitKV,
    rateLimitKeyPrefix: _rateLimitKeyPrefix,
    ...requestInit
  } = options;

  const headers = buildGitHubRequestHeaders(url, {
    token,
    headers: extraHeaders,
    apiVersion,
    userAgent,
  });

  const statuses = new Set(retryableStatuses ?? Array.from(DEFAULT_RETRYABLE_STATUSES));
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...requestInit,
        headers,
      });

      if (attempt < maxRetries && shouldRetryResponse(response, statuses, retryRateLimit)) {
        const retryAfterMs = parseRetryAfterMs(response.headers);
        const delayMs = Math.min(
          maxDelayMs,
          retryAfterMs ?? getBackoffDelayMs(attempt, maxDelayMs)
        );
        await sleep(delayMs);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) throw err;
      const delayMs = getBackoffDelayMs(attempt, maxDelayMs);
      await sleep(delayMs);
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('GitHub request failed');
}
