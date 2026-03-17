import type { GitHubRequestOptions } from './request';
import {
  buildGitHubRequestHeaders,
  getUrlHost,
  isGitHubApiHost,
  isGitHubRateLimitResponse,
  rawGitHubRequest,
} from './core';
import { classifyGitHubEndpoint, tryGraphqlFallbackForRestRateLimit } from './endpoints';
import { GitHubRateLimitError } from './graphql';
import { recordRateLimitFromHeaders, recordRateLimitFromRateLimitBody } from './rate-limit-kv';

// Cloudflare Workers extends CacheStorage with a 'default' property
declare const caches: CacheStorage & { default: Cache };

const CACHE_NAMESPACE = 'https://skills.cat/github-rest-cache';
const CACHE_SCHEMA_VERSION = 'v1';
const DEFAULT_SHARED_CACHE_TTL_SECONDS = 3600;
const ENABLE_REST_CONDITIONAL_CACHE = (typeof process !== 'undefined' ? process.env.GITHUB_REST_CONDITIONAL_CACHE_ENABLED : undefined) !== '0';
const ENABLE_GRAPHQL_FALLBACK = (typeof process !== 'undefined' ? process.env.GITHUB_GRAPHQL_FALLBACK_ENABLED : undefined) !== '0';

function hasAuthorizationContext(options: GitHubRequestOptions): boolean {
  if (options.token) return true;
  const headers = new Headers(options.headers ?? {});
  return headers.has('Authorization');
}

function normalizeUrlForCache(url: URL): string {
  const cloned = new URL(url.toString());
  const entries = [...cloned.searchParams.entries()].sort((a, b) => {
    if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
    return a[1].localeCompare(b[1]);
  });
  cloned.search = '';
  for (const [key, value] of entries) cloned.searchParams.append(key, value);
  return cloned.toString();
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  return [...view].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildSharedCacheRequest(url: URL, options: GitHubRequestOptions): Promise<Request> {
  const headers = buildGitHubRequestHeaders(url.toString(), {
    token: undefined,
    headers: options.headers,
    apiVersion: options.apiVersion,
    userAgent: options.userAgent,
  });
  const accept = headers.get('Accept') || '';
  const version = headers.get('X-GitHub-Api-Version') || '';
  const canonical = `${normalizeUrlForCache(url)}\naccept=${accept}\nversion=${version}`;
  const digest = await sha256Hex(canonical);
  return new Request(`${CACHE_NAMESPACE}/${CACHE_SCHEMA_VERSION}/${digest}`);
}

function canUseSharedCache(endpoint: ReturnType<typeof classifyGitHubEndpoint>, options: GitHubRequestOptions, method: string): boolean {
  if (!ENABLE_REST_CONDITIONAL_CACHE) return false;
  if ((options.cache ?? 'auto') === 'off') return false;
  if (method !== 'GET') return false;
  if (endpoint.cachePolicy !== 'shared') return false;
  if (endpoint.viewerScoped || options.viewerScoped) return false;
  // Do not share cached responses across callers when auth is attached.
  // Some REST GET endpoints can return private/token-scoped data.
  if (hasAuthorizationContext(options)) return false;
  return true;
}

function canUseGraphqlFallback(endpoint: ReturnType<typeof classifyGitHubEndpoint>, options: GitHubRequestOptions, method: string): boolean {
  if (!ENABLE_GRAPHQL_FALLBACK) return false;
  if ((options.graphqlFallback ?? 'auto') === 'off') return false;
  if (method !== 'GET') return false;
  if (endpoint.viewerScoped || options.viewerScoped) return false;
  return endpoint.supportsGraphqlFallback;
}

function cloneResponseWithCacheHeaders(response: Response, ttlSeconds: number): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function getCacheOrNull(request: Request): Promise<Response | null> {
  try {
    return (await caches.default.match(request)) ?? null;
  } catch {
    return null;
  }
}

async function putCacheIfPossible(request: Request, response: Response, ttlSeconds: number): Promise<void> {
  try {
    await caches.default.put(request, cloneResponseWithCacheHeaders(response.clone(), ttlSeconds));
  } catch {
    // Cache API unavailable in local dev or write failed. Ignore.
  }
}

function getConditionalValidators(cached: Response): { etag: string | null; lastModified: string | null } {
  return {
    etag: cached.headers.get('etag'),
    lastModified: cached.headers.get('last-modified'),
  };
}

function withConditionalHeaders(options: GitHubRequestOptions, validators: { etag: string | null; lastModified: string | null }): GitHubRequestOptions {
  const headers = new Headers(options.headers ?? {});
  if (validators.etag) headers.set('If-None-Match', validators.etag);
  else if (validators.lastModified) headers.set('If-Modified-Since', validators.lastModified);

  return {
    ...options,
    headers,
  };
}

async function maybeGraphqlFallback(
  url: URL,
  method: string,
  options: GitHubRequestOptions,
  endpoint: ReturnType<typeof classifyGitHubEndpoint>,
  restRateLimitedResponse: Response
): Promise<Response | null> {
  if (!canUseGraphqlFallback(endpoint, options, method)) {
    return null;
  }

  try {
    return await tryGraphqlFallbackForRestRateLimit({ url, method, options, endpoint });
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      return restRateLimitedResponse;
    }
    throw err;
  }
}

async function sendRaw(url: string, options: GitHubRequestOptions): Promise<Response> {
  return rawGitHubRequest(url, {
    ...options,
    retryRateLimit: false,
  });
}

async function maybeRecordRestRateLimitFromResponse(
  response: Response,
  options: GitHubRequestOptions
): Promise<void> {
  if (!options.rateLimitKV) return;

  await recordRateLimitFromHeaders(response.headers, 'rest', {
    kv: options.rateLimitKV,
    keyPrefix: options.rateLimitKeyPrefix,
    endpointId: options.endpointId,
  });

  if (options.endpointId !== 'rate_limit' || !response.ok) return;

  const isJson = (response.headers.get('content-type') || '').toLowerCase().includes('application/json');
  if (!isJson) return;

  try {
    const body = await response.clone().json() as unknown;
    await recordRateLimitFromRateLimitBody(body, {
      kv: options.rateLimitKV,
      keyPrefix: options.rateLimitKeyPrefix,
      endpointId: options.endpointId,
    });
  } catch {
    // Ignore invalid rate_limit payloads; headers-based snapshot is already recorded.
  }
}

/**
 * Centralized GitHub transport gateway.
 * Applies shared conditional REST caching and REST->GraphQL fallback on rate limit.
 */
export async function sendGitHubRequestThroughGateway(
  urlString: string,
  options: GitHubRequestOptions = {}
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return sendRaw(urlString, options);
  }

  const method = (options.method || 'GET').toUpperCase();
  const host = getUrlHost(urlString);
  const isApiHost = isGitHubApiHost(host);
  if (!isApiHost) {
    return sendRaw(urlString, options);
  }

  const endpoint = classifyGitHubEndpoint(url, method);
  const sharedCacheEnabled = canUseSharedCache(endpoint, options, method);
  const cacheTtl = options.cacheTtlSeconds ?? endpoint.cacheTtlSeconds ?? DEFAULT_SHARED_CACHE_TTL_SECONDS;
  const fallbackCacheTtl = endpoint.fallbackCacheTtlSeconds ?? 60;

  let cacheRequest: Request | null = null;
  let cachedResponse: Response | null = null;

  if (sharedCacheEnabled) {
    cacheRequest = await buildSharedCacheRequest(url, options);
    cachedResponse = await getCacheOrNull(cacheRequest);
  }

  if (cachedResponse) {
    const validators = endpoint.supportsConditionalGet ? getConditionalValidators(cachedResponse) : { etag: null, lastModified: null };

    if (!validators.etag && !validators.lastModified) {
      return cachedResponse;
    }

    const conditionalOptions = withConditionalHeaders(options, validators);
    const conditionalResponse = await sendRaw(urlString, conditionalOptions);
    await maybeRecordRestRateLimitFromResponse(conditionalResponse, conditionalOptions);

    if (conditionalResponse.status === 304) {
      return cachedResponse;
    }

    if (isGitHubRateLimitResponse(conditionalResponse)) {
      const fallback = await maybeGraphqlFallback(url, method, options, endpoint, conditionalResponse.clone());
      if (fallback) {
        if (cacheRequest) await putCacheIfPossible(cacheRequest, fallback.clone(), fallbackCacheTtl);
        return fallback;
      }
      return conditionalResponse;
    }

    if (conditionalResponse.ok && cacheRequest) {
      await putCacheIfPossible(cacheRequest, conditionalResponse.clone(), cacheTtl);
    }

    return conditionalResponse;
  }

  const response = await sendRaw(urlString, options);
  await maybeRecordRestRateLimitFromResponse(response, options);

  if (isGitHubRateLimitResponse(response)) {
    const fallback = await maybeGraphqlFallback(url, method, options, endpoint, response.clone());
    if (fallback) {
      if (cacheRequest) await putCacheIfPossible(cacheRequest, fallback.clone(), fallbackCacheTtl);
      return fallback;
    }
    return response;
  }

  if (response.ok && sharedCacheEnabled && cacheRequest) {
    await putCacheIfPossible(cacheRequest, response.clone(), cacheTtl);
  }

  return response;
}
