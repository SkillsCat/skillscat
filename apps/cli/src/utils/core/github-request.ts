const DEFAULT_API_VERSION = '2022-11-28';
const DEFAULT_USER_AGENT = 'skillscat-cli/1.0';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
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

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get('x-ratelimit-remaining') === '0') return true;
  return response.headers.has('retry-after');
}

function getBackoffDelayMs(attempt: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, 500 * (2 ** attempt));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxDelayMs, exponential + jitter);
}

function getUrlHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isGitHubDomain(host: string | null): boolean {
  if (!host) return false;
  return host === 'github.com'
    || host.endsWith('.github.com')
    || host === 'githubusercontent.com'
    || host.endsWith('.githubusercontent.com');
}

export interface GitHubRequestOptions extends Omit<RequestInit, 'headers'> {
  token?: string;
  headers?: Record<string, string> | [string, string][] | Headers;
  apiVersion?: string;
  userAgent?: string;
  maxRetries?: number;
  retryableStatuses?: number[];
  maxDelayMs?: number;
}

/**
 * Unified GitHub request helper with retry on rate limits / transient errors.
 */
export async function githubRequest(
  url: string,
  options: GitHubRequestOptions = {}
): Promise<Response> {
  const {
    token,
    headers: extraHeaders,
    apiVersion = DEFAULT_API_VERSION,
    userAgent = DEFAULT_USER_AGENT,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryableStatuses,
    maxDelayMs = 30_000,
    ...requestInit
  } = options;

  const host = getUrlHost(url);
  const githubDomain = isGitHubDomain(host);
  const isApiHost = host === 'api.github.com';

  const headers = new Headers(extraHeaders ?? {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json');
  if (isApiHost && apiVersion && !headers.has('X-GitHub-Api-Version')) {
    headers.set('X-GitHub-Api-Version', apiVersion);
  }
  if (!headers.has('User-Agent')) headers.set('User-Agent', userAgent);
  if (githubDomain && token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const statuses = new Set(retryableStatuses ?? Array.from(DEFAULT_RETRYABLE_STATUSES));
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...requestInit,
        headers,
      });

      const shouldRetry =
        statuses.has(response.status) || isRateLimited(response);

      if (attempt < maxRetries && shouldRetry) {
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
      await sleep(getBackoffDelayMs(attempt, maxDelayMs));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('GitHub request failed');
}
