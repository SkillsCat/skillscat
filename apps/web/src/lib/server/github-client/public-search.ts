/**
 * 匿名 GitHub HTML 搜索发现
 *
 * 抓取 github.com/search 的仓库搜索结果页,解析 react-app.embeddedData
 * 嵌入 JSON 中的仓库列表。整条链路零 GitHub API 配额:
 * - 沿用 public-web 的匿名纪律(SkillsCat UA、无 Authorization/Cookie、超时)
 * - Cache API 短 TTL 缓存解析结果,写缓存走 waitUntil
 * - schema 不符时抛 PublicRepoSearchError(reason='schema_changed'),由调用方
 *   记日志跳过,绝不进入队列重试链路
 */

import { extractGitHubEmbeddedData } from './public-web';

declare const caches: CacheStorage & { default: Cache };

const SEARCH_CACHE_NAMESPACE = 'https://skills.cat/github-public-web-cache/v1/repo-search';
const SEARCH_CACHE_TTL_SECONDS = 10 * 60;
const SKILL_MD_CHECK_CACHE_TTL_SECONDS = 6 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_HTML_BYTES = 5 * 1024 * 1024;

export type PublicRepoSearchErrorReason = 'request_failed' | 'rate_limited' | 'schema_changed';

export class PublicRepoSearchError extends Error {
  readonly reason: PublicRepoSearchErrorReason;
  readonly status: number | null;

  constructor(
    reason: PublicRepoSearchErrorReason,
    message: string,
    options?: { status?: number | null; cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PublicRepoSearchError';
    this.reason = reason;
    this.status = options?.status ?? null;
  }
}

export interface PublicRepoSearchResult {
  owner: string;
  name: string;
  stars?: number;
  description?: string;
}

export interface FetchPublicSkillRepoSearchPageOptions {
  query: string;
  page?: number;
  fetch?: typeof fetch;
  cache?: boolean;
  /** Offloads cache writes off the critical path (e.g. ExecutionContext.waitUntil). */
  waitUntil?: (promise: Promise<unknown>) => void;
  fetchTimeoutMs?: number;
  maxHtmlBytes?: number;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stripHighlightMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

function isValidRepoNamePart(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('\0');
}

/**
 * 解析 GitHub 仓库搜索页。真实结构(2026-08 curl 确认):
 * payload.blackbirdSearchRoute.results[] — 每项 repo.repository.owner_login /
 * repo.repository.name,stars 在 followers,描述在 hl_trunc_description(可能带高亮标签)。
 */
export function parsePublicGitHubRepoSearchHtml(html: string): PublicRepoSearchResult[] {
  let embedded: JsonRecord;
  try {
    embedded = extractGitHubEmbeddedData(html);
  } catch (cause) {
    throw new PublicRepoSearchError(
      'schema_changed',
      'GitHub search page embedded JSON could not be extracted',
      { cause }
    );
  }
  const payload = asRecord(embedded.payload);
  const route = asRecord(payload?.blackbirdSearchRoute);
  const results = route?.results;
  if (!Array.isArray(results)) {
    throw new PublicRepoSearchError(
      'schema_changed',
      'GitHub search embedded payload is missing blackbirdSearchRoute.results'
    );
  }

  const repos: PublicRepoSearchResult[] = [];
  for (const itemValue of results) {
    const item = asRecord(itemValue);
    const repository = asRecord(asRecord(item?.repo)?.repository);
    const owner = asString(repository?.owner_login);
    const name = asString(repository?.name);
    if (!owner || !name || !isValidRepoNamePart(owner) || !isValidRepoNamePart(name)) {
      continue;
    }

    const stars = asFiniteNumber(item?.followers);
    const rawDescription = asString(item?.hl_trunc_description);
    const description = rawDescription ? stripHighlightMarkup(rawDescription) : null;

    repos.push({
      owner,
      name,
      ...(stars === null ? {} : { stars: Math.max(0, Math.trunc(stars)) }),
      ...(description ? { description } : {}),
    });
  }

  return repos;
}

function getCache(): Cache | null {
  try {
    return typeof caches === 'undefined' ? null : caches.default;
  } catch {
    return null;
  }
}

async function readSearchCache(key: string): Promise<PublicRepoSearchResult[] | null> {
  const cache = getCache();
  if (!cache) return null;
  try {
    const response = await cache.match(new Request(key));
    if (!response) return null;
    const value = await response.json() as unknown;
    if (!Array.isArray(value)) return null;
    const results: PublicRepoSearchResult[] = [];
    for (const entry of value) {
      const record = asRecord(entry);
      const owner = asString(record?.owner);
      const name = asString(record?.name);
      if (!owner || !name) return null;
      const stars = asFiniteNumber(record?.stars);
      const description = asString(record?.description);
      results.push({
        owner,
        name,
        ...(stars === null ? {} : { stars }),
        ...(description ? { description } : {}),
      });
    }
    return results;
  } catch {
    return null;
  }
}

async function writeSearchCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const cache = getCache();
  if (!cache) return;
  try {
    await cache.put(new Request(key), new Response(JSON.stringify(value), {
      headers: {
        'Cache-Control': `public, max-age=${ttlSeconds}`,
        'Content-Type': 'application/json',
      },
    }));
  } catch {
    // Cache API can be unavailable in local tests and must not break discovery.
  }
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The connection may already be closed.
  }
}

async function anonymousFetch(
  fetchImpl: typeof fetch,
  url: string,
  accept: string,
  timeoutMs: number
): Promise<Response> {
  const headers = new Headers({ Accept: accept, 'User-Agent': 'SkillsCat/1.0' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers,
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (cause) {
    throw new PublicRepoSearchError('request_failed', `Public GitHub request failed: ${url}`, { cause });
  } finally {
    clearTimeout(timeout);
  }
}

export function buildPublicRepoSearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    q: query,
    type: 'repositories',
    s: 'updated',
    o: 'desc',
    p: String(Math.max(1, Math.floor(page))),
  });
  return `https://github.com/search?${params.toString()}`;
}

/**
 * 抓取并解析一页 GitHub 仓库搜索结果。任何失败都抛 PublicRepoSearchError,
 * 调用方记日志跳过即可,不要进队列重试。
 */
export async function fetchPublicSkillRepoSearchPage(
  options: FetchPublicSkillRepoSearchPageOptions
): Promise<PublicRepoSearchResult[]> {
  const query = options.query.trim();
  if (!query) {
    throw new PublicRepoSearchError('request_failed', 'GitHub repo search query is empty');
  }
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const fetchImpl = options.fetch ?? fetch;
  const useCache = options.cache ?? true;
  const cacheKey = `${SEARCH_CACHE_NAMESPACE}/${encodeURIComponent(query.toLowerCase())}?p=${page}`;

  if (useCache) {
    const cached = await readSearchCache(cacheKey);
    if (cached) return cached;
  }

  const response = await anonymousFetch(
    fetchImpl,
    buildPublicRepoSearchUrl(query, page),
    'text/html',
    options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS
  );
  if (response.status === 429 || response.status === 403) {
    await cancelBody(response);
    throw new PublicRepoSearchError(
      'rate_limited',
      `GitHub repo search HTML was rate limited with ${response.status}`,
      { status: response.status }
    );
  }
  if (!response.ok) {
    await cancelBody(response);
    throw new PublicRepoSearchError(
      'request_failed',
      `GitHub repo search HTML failed with ${response.status}`,
      { status: response.status }
    );
  }

  const maxBytes = options.maxHtmlBytes ?? MAX_SEARCH_HTML_BYTES;
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelBody(response);
    throw new PublicRepoSearchError('request_failed', 'GitHub repo search HTML exceeds size limit');
  }
  const html = await response.text();
  if (html.length > maxBytes) {
    throw new PublicRepoSearchError('request_failed', 'GitHub repo search HTML exceeds size limit');
  }

  const results = parsePublicGitHubRepoSearchHtml(html);
  if (useCache) {
    const write = writeSearchCache(cacheKey, results, SEARCH_CACHE_TTL_SECONDS);
    if (options.waitUntil) {
      try {
        options.waitUntil(write);
      } catch {
        // waitUntil throws when the execution context is already closed;
        // cache writes are best-effort and must not break discovery.
      }
    } else {
      await write;
    }
  }
  return results;
}

/**
 * 零配额校验仓库默认分支根目录是否存在 SKILL.md。
 * 通过 github.com/<owner>/<repo>/raw/HEAD/SKILL.md 抓取,GitHub 会 302 到
 * 默认分支的 raw.githubusercontent.com,不需要知道默认分支名。
 */
export async function checkPublicSkillMdAtHead(
  owner: string,
  name: string,
  options: {
    fetch?: typeof fetch;
    cache?: boolean;
    waitUntil?: (promise: Promise<unknown>) => void;
    fetchTimeoutMs?: number;
  } = {}
): Promise<boolean> {
  const fetchImpl = options.fetch ?? fetch;
  const useCache = options.cache ?? true;
  const cacheKey = `${SEARCH_CACHE_NAMESPACE}/skill-md/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}`;

  if (useCache) {
    const cache = getCache();
    if (cache) {
      try {
        const cached = await cache.match(new Request(cacheKey));
        if (cached) {
          const value = await cached.json() as unknown;
          if (typeof value === 'boolean') return value;
        }
      } catch {
        // Cache misses and parse errors fall through to the network check.
      }
    }
  }

  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/raw/HEAD/SKILL.md`;
  const response = await anonymousFetch(fetchImpl, url, 'text/plain', options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS);
  const exists = response.status === 200;
  await cancelBody(response);

  if (useCache) {
    const write = writeSearchCache(cacheKey, exists, SKILL_MD_CHECK_CACHE_TTL_SECONDS);
    if (options.waitUntil) {
      try {
        options.waitUntil(write);
      } catch {
        // Best-effort cache write; see above.
      }
    } else {
      await write;
    }
  }

  return exists;
}
