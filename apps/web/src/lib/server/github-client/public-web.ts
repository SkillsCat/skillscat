import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';

declare const caches: CacheStorage & { default: Cache };

const CACHE_NAMESPACE = 'https://skills.cat/github-public-web-cache';
const CACHE_SCHEMA_VERSION = 'v1';
const REPO_CACHE_TTL_SECONDS = 5 * 60;
const SNAPSHOT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const COMMIT_CACHE_TTL_SECONDS = 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const ZIP_PUSH_CHUNK_BYTES = 64 * 1024;
const MAX_REPOSITORY_PATH_LENGTH = 4096;
const MAX_REPOSITORY_PATH_SEGMENTS = 128;

export const PUBLIC_REPOSITORY_DEFAULT_LIMITS = {
  maxZipBytes: 20 * 1024 * 1024,
  maxEntries: 20_000,
  maxHtmlPages: 30,
  htmlConcurrency: 3,
} as const;

type PublicRepositoryFallbackReason =
  | 'not_public'
  | 'request_failed'
  | 'commit_mismatch'
  | 'schema_changed'
  | 'zip_too_large'
  | 'zip_invalid'
  | 'entry_limit'
  | 'html_page_limit'
  | 'file_too_large';

export class PublicRepositoryFallbackError extends Error {
  readonly reason: PublicRepositoryFallbackReason;
  readonly status: number | null;

  constructor(
    reason: PublicRepositoryFallbackReason,
    message: string,
    options?: { status?: number | null; cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PublicRepositoryFallbackError';
    this.reason = reason;
    this.status = options?.status ?? null;
  }
}

export class PublicRepositoryFileTooLargeError extends PublicRepositoryFallbackError {
  readonly path: string;
  readonly maxBytes: number;

  constructor(path: string, maxBytes: number) {
    super('file_too_large', `Public GitHub file exceeds ${maxBytes} bytes: ${path}`);
    this.name = 'PublicRepositoryFileTooLargeError';
    this.path = path;
    this.maxBytes = maxBytes;
  }
}

export interface PublicRepositoryEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
  sha?: string;
}

export interface PublicGitHubRepositoryMetadata {
  id: number;
  name: string;
  ownerLogin: string;
  ownerId: number;
  ownerAvatarUrl: string;
  ownerType: 'User' | 'Organization';
  htmlUrl: string;
  description: string | null;
  isFork: boolean;
  createdAt: string;
  stars: number;
  forks: number;
  defaultBranch: string;
  headSha: string;
  topics: string[];
  rootEntries: PublicRepositoryEntry[];
  rootTotalCount: number;
}

export interface PublicRepositoryFile {
  path: string;
  bytes: Uint8Array;
  size: number;
  blobSha: string;
}

export interface PublicRepositorySnapshot {
  metadata: PublicGitHubRepositoryMetadata;
  source: 'zip' | 'html';
  entries: PublicRepositoryEntry[];
  truncated: boolean;
  capturedFiles: ReadonlyMap<string, PublicRepositoryFile>;
  diagnostics: {
    cacheHit: boolean;
    zipBytes?: number;
    htmlPages?: number;
    zipFallbackReason?: PublicRepositoryFallbackReason;
  };
}

export interface PublicRepositoryCaptureOptions {
  basePath: string | null;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface PublicGitHubRepositoryReaderOptions {
  fetch?: typeof fetch;
  cache?: boolean;
  /** Offloads cache writes off the critical path (e.g. ExecutionContext.waitUntil). */
  waitUntil?: (promise: Promise<unknown>) => void;
  maxZipBytes?: number;
  maxEntries?: number;
  maxHtmlPages?: number;
  htmlConcurrency?: number;
  maxHtmlBytes?: number;
  fetchTimeoutMs?: number;
  expectedHeadSha?: string;
}

interface CachedSnapshot {
  source: 'zip' | 'html';
  entries: PublicRepositoryEntry[];
  truncated: boolean;
  diagnostics: {
    zipBytes?: number;
    htmlPages?: number;
    zipFallbackReason?: PublicRepositoryFallbackReason;
  };
}

interface ParsedTreePage {
  path: string;
  headSha: string;
  entries: PublicRepositoryEntry[];
  totalCount: number;
}

interface CaptureState {
  options: PublicRepositoryCaptureOptions;
  selectedFiles: number;
  reservedBytes: number;
  actualBytes: number;
}

interface TimedPublicResponse {
  response: Response;
  release: () => void;
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

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function getRecord(record: JsonRecord | null, key: string): JsonRecord | null {
  return record ? asRecord(record[key]) : null;
}

function normalizeRepositoryPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!normalized) return '';
  if (
    normalized.length > MAX_REPOSITORY_PATH_LENGTH
    || normalized.includes('\\')
    || normalized.includes('\0')
  ) {
    throw new PublicRepositoryFallbackError('schema_changed', `Invalid repository path: ${path}`);
  }
  const segments = normalized.split('/');
  if (
    segments.length > MAX_REPOSITORY_PATH_SEGMENTS
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new PublicRepositoryFallbackError('schema_changed', `Invalid repository path: ${path}`);
  }
  return normalized;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function isCommitSha(value: string | null): value is string {
  return !!value && /^[a-f0-9]{40,64}$/i.test(value);
}

function parseTreeEntries(value: unknown): { entries: PublicRepositoryEntry[]; totalCount: number } {
  const tree = asRecord(value);
  const items = Array.isArray(tree?.items) ? tree.items : null;
  if (!tree || !items) {
    throw new PublicRepositoryFallbackError('schema_changed', 'GitHub embedded tree payload is unavailable');
  }

  const entries: PublicRepositoryEntry[] = [];
  for (const itemValue of items) {
    const item = asRecord(itemValue);
    const path = asString(item?.path);
    const contentType = asString(item?.contentType);
    if (!path || !contentType) continue;

    const normalizedPath = normalizeRepositoryPath(path);
    if (!normalizedPath) continue;
    entries.push({
      path: normalizedPath,
      type: contentType === 'directory' ? 'tree' : 'blob',
    });
  }

  const totalCount = asFiniteNumber(tree.totalCount) ?? entries.length;
  return {
    entries,
    totalCount: Math.max(entries.length, Math.trunc(totalCount)),
  };
}

export function extractGitHubEmbeddedData(html: string): JsonRecord {
  const openingTag = html.match(
    /<script\b[^>]*\bdata-target\s*=\s*(?:"react-app\.embeddedData"|'react-app\.embeddedData')[^>]*>/i
  );
  if (!openingTag || openingTag.index === undefined) {
    throw new PublicRepositoryFallbackError('schema_changed', 'GitHub embedded JSON script was not found');
  }

  const contentStart = openingTag.index + openingTag[0].length;
  const contentEnd = html.indexOf('</script>', contentStart);
  if (contentEnd < 0) {
    throw new PublicRepositoryFallbackError('schema_changed', 'GitHub embedded JSON script was incomplete');
  }

  try {
    const parsed = JSON.parse(html.slice(contentStart, contentEnd)) as unknown;
    const record = asRecord(parsed);
    if (!record) throw new Error('Embedded payload is not an object');
    return record;
  } catch (cause) {
    throw new PublicRepositoryFallbackError(
      'schema_changed',
      'GitHub embedded JSON could not be parsed',
      { cause }
    );
  }
}

export function parsePublicGitHubRepositoryHtml(
  html: string,
  requestedOwner: string,
  requestedRepo: string
): PublicGitHubRepositoryMetadata {
  const embedded = extractGitHubEmbeddedData(html);
  const payload = getRecord(embedded, 'payload');
  const repoRoute = getRecord(payload, 'codeViewRepoRoute');
  const layoutRoute = getRecord(payload, 'codeViewLayoutRoute');
  const sidebar = getRecord(payload, 'sidebarAbout');
  const sidebarRepo = getRecord(sidebar, 'repo');
  const repo = getRecord(layoutRoute, 'repo') ?? getRecord(payload, 'repo');
  const refInfo = getRecord(repoRoute, 'refInfo')
    ?? getRecord(layoutRoute, 'refInfo')
    ?? getRecord(payload, 'refInfo');
  const treeValue = repoRoute?.tree ?? payload?.tree;

  const id = asFiniteNumber(repo?.id);
  const name = asString(repo?.name) ?? asString(sidebar?.repoName);
  const ownerLogin = asString(repo?.ownerLogin) ?? asString(sidebar?.ownerLogin);
  const ownerId = asFiniteNumber(sidebarRepo?.ownerId);
  const ownerAvatarUrl = asString(sidebarRepo?.ownerAvatarUrl)
    ?? asString(repo?.ownerAvatar);
  const defaultBranch = asString(repo?.defaultBranch)
    ?? (asString(refInfo?.refType) === 'branch' ? asString(refInfo?.name) : null);
  const headSha = asString(refInfo?.currentOid);
  const createdAt = asString(repo?.createdAt);
  const isPrivate = asBoolean(repo?.private) ?? asBoolean(sidebarRepo?.isPrivate);
  const isPublic = asBoolean(repo?.public);
  const isFork = asBoolean(repo?.isFork) ?? asBoolean(sidebarRepo?.isFork);
  const isOrgOwned = asBoolean(repo?.isOrgOwned);
  const stars = asFiniteNumber(sidebar?.stargazerCount);
  const forks = asFiniteNumber(sidebar?.forksCount);

  if (
    id === null
    || !name
    || !ownerLogin
    || ownerId === null
    || !ownerAvatarUrl
    || !defaultBranch
    || !isCommitSha(headSha)
    || !createdAt
    || !Number.isFinite(Date.parse(createdAt))
    || isFork === null
    || isOrgOwned === null
    || stars === null
    || forks === null
    || (isPrivate !== false && isPublic !== true)
  ) {
    throw new PublicRepositoryFallbackError('schema_changed', 'GitHub repository metadata schema changed');
  }
  if (isPrivate === true || isPublic === false) {
    throw new PublicRepositoryFallbackError('not_public', `${requestedOwner}/${requestedRepo} is not public`);
  }

  const { entries: rootEntries, totalCount: rootTotalCount } = parseTreeEntries(treeValue);
  const topicValues = Array.isArray(sidebar?.topics) ? sidebar.topics : [];
  const topics = topicValues.flatMap((topicValue) => {
    if (typeof topicValue === 'string') return topicValue ? [topicValue] : [];
    const topic = asRecord(topicValue);
    const nameValue = asString(topic?.name);
    return nameValue ? [nameValue] : [];
  });

  return {
    id: Math.trunc(id),
    name,
    ownerLogin,
    ownerId: Math.trunc(ownerId),
    ownerAvatarUrl,
    ownerType: isOrgOwned ? 'Organization' : 'User',
    htmlUrl: `https://github.com/${ownerLogin}/${name}`,
    description: asString(sidebar?.description),
    isFork,
    createdAt,
    stars: Math.max(0, Math.trunc(stars)),
    forks: Math.max(0, Math.trunc(forks)),
    defaultBranch,
    headSha,
    topics,
    rootEntries,
    rootTotalCount,
  };
}

export function parsePublicGitHubTreeHtml(html: string): ParsedTreePage {
  const embedded = extractGitHubEmbeddedData(html);
  const payload = getRecord(embedded, 'payload');
  const treeRoute = getRecord(payload, 'codeViewTreeRoute') ?? payload;
  const refInfo = getRecord(treeRoute, 'refInfo')
    ?? getRecord(getRecord(payload, 'codeViewLayoutRoute'), 'refInfo')
    ?? getRecord(payload, 'refInfo');
  const path = asString(treeRoute?.path) ?? '';
  const headSha = asString(refInfo?.currentOid);
  if (!isCommitSha(headSha)) {
    throw new PublicRepositoryFallbackError('schema_changed', 'GitHub tree commit SHA is unavailable');
  }

  const { entries, totalCount } = parseTreeEntries(treeRoute?.tree ?? payload?.tree);
  return {
    path: normalizeRepositoryPath(path),
    headSha,
    entries,
    totalCount,
  };
}

function isMetadata(value: unknown): value is PublicGitHubRepositoryMetadata {
  const metadata = asRecord(value);
  return !!metadata
    && typeof metadata.id === 'number'
    && Number.isFinite(metadata.id)
    && typeof metadata.name === 'string'
    && typeof metadata.ownerLogin === 'string'
    && typeof metadata.ownerId === 'number'
    && Number.isFinite(metadata.ownerId)
    && typeof metadata.ownerAvatarUrl === 'string'
    && (metadata.ownerType === 'User' || metadata.ownerType === 'Organization')
    && typeof metadata.isFork === 'boolean'
    && typeof metadata.createdAt === 'string'
    && Number.isFinite(Date.parse(metadata.createdAt))
    && typeof metadata.stars === 'number'
    && Number.isFinite(metadata.stars)
    && metadata.stars >= 0
    && typeof metadata.forks === 'number'
    && Number.isFinite(metadata.forks)
    && metadata.forks >= 0
    && typeof metadata.defaultBranch === 'string'
    && isCommitSha(asString(metadata.headSha))
    && Array.isArray(metadata.topics)
    && metadata.topics.every((topic) => typeof topic === 'string')
    && Array.isArray(metadata.rootEntries)
    && metadata.rootEntries.every(isSnapshotEntry)
    && typeof metadata.rootTotalCount === 'number'
    && Number.isFinite(metadata.rootTotalCount)
    && metadata.rootTotalCount >= metadata.rootEntries.length;
}

function isSnapshotEntry(value: unknown): value is PublicRepositoryEntry {
  const entry = asRecord(value);
  return !!entry
    && typeof entry.path === 'string'
    && (entry.type === 'blob' || entry.type === 'tree')
    && (entry.size === undefined || typeof entry.size === 'number')
    && (entry.sha === undefined || typeof entry.sha === 'string');
}

function isCachedSnapshot(value: unknown): value is CachedSnapshot {
  const snapshot = asRecord(value);
  return !!snapshot
    && (snapshot.source === 'zip' || snapshot.source === 'html')
    && typeof snapshot.truncated === 'boolean'
    && Array.isArray(snapshot.entries)
    && snapshot.entries.every(isSnapshotEntry)
    && !!asRecord(snapshot.diagnostics);
}

function getCache(): Cache | null {
  try {
    return typeof caches === 'undefined' ? null : caches.default;
  } catch {
    return null;
  }
}

async function readJsonCache<T>(key: string, validate: (value: unknown) => value is T): Promise<T | null> {
  const cache = getCache();
  if (!cache) return null;
  try {
    const response = await cache.match(new Request(key));
    if (!response) return null;
    const value = await response.json() as unknown;
    return validate(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeJsonCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
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
    // Cache API can be unavailable in local tests and should not block fallback reads.
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

async function readBytesLimited(
  response: Response,
  maxBytes: number,
  pathForError: string
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelBody(response);
    throw new PublicRepositoryFileTooLargeError(pathForError, maxBytes);
  }
  if (!response.body) {
    throw new PublicRepositoryFallbackError('request_failed', `GitHub response body is unavailable: ${pathForError}`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The connection may already be closed.
        }
        throw new PublicRepositoryFileTooLargeError(pathForError, maxBytes);
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof PublicRepositoryFallbackError) throw cause;
    try {
      await reader.cancel();
    } catch {
      // The connection may already be closed.
    }
    throw new PublicRepositoryFallbackError(
      'request_failed',
      `GitHub response body failed: ${pathForError}`,
      { cause }
    );
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const payload = new Uint8Array(header.byteLength + bytes.byteLength);
  payload.set(header);
  payload.set(bytes, header.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', payload);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function addEntryWithParents(
  entries: Map<string, PublicRepositoryEntry>,
  entry: PublicRepositoryEntry,
  maxEntries: number = Number.POSITIVE_INFINITY
): boolean {
  const parts = entry.path.split('/');
  for (let index = 1; index < parts.length; index++) {
    const parentPath = parts.slice(0, index).join('/');
    if (!entries.has(parentPath)) {
      if (entries.size >= maxEntries) return false;
      entries.set(parentPath, { path: parentPath, type: 'tree' });
    }
  }
  const existing = entries.get(entry.path);
  if (!existing || existing.type === 'tree' || entry.type === 'blob') {
    if (!existing && entries.size >= maxEntries) return false;
    entries.set(entry.path, entry);
  }
  return true;
}

function sortEntries(entries: Iterable<PublicRepositoryEntry>): PublicRepositoryEntry[] {
  return [...entries].sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    if (pathOrder !== 0) return pathOrder;
    return left.type === right.type ? 0 : left.type === 'tree' ? -1 : 1;
  });
}

function getCaptureRelativePath(path: string, basePath: string | null): string | null {
  const normalizedBasePath = normalizeRepositoryPath(basePath || '');
  if (!normalizedBasePath) return path;
  const prefix = `${normalizedBasePath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function shouldCaptureFile(
  path: string,
  reportedSize: number | undefined,
  state: CaptureState
): boolean {
  if (getCaptureRelativePath(path, state.options.basePath) === null) return false;
  if (state.selectedFiles >= state.options.maxFiles) return false;
  if (reportedSize !== undefined && reportedSize > state.options.maxFileBytes) return false;
  if (
    reportedSize !== undefined
    && state.reservedBytes + reportedSize > state.options.maxTotalBytes
  ) {
    return false;
  }

  state.selectedFiles++;
  state.reservedBytes += reportedSize ?? 0;
  return true;
}

function captureZipFile(
  file: UnzipFile,
  path: string,
  state: CaptureState,
  capturedFiles: Map<string, PublicRepositoryFile>,
  pendingCaptures: Promise<void>[]
): void {
  const reportedSize = typeof file.originalSize === 'number' ? file.originalSize : undefined;
  if (!shouldCaptureFile(path, reportedSize, state)) return;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let discarded = false;
  let resolveCapture: () => void = () => {};
  let rejectCapture: (error: unknown) => void = () => {};
  pendingCaptures.push(new Promise<void>((resolve, reject) => {
    resolveCapture = resolve;
    rejectCapture = reject;
  }));

  file.ondata = (error, chunk, final) => {
    if (error) {
      rejectCapture(error);
      return;
    }
    if (!discarded && chunk.byteLength > 0) {
      if (
        totalBytes + chunk.byteLength > state.options.maxFileBytes
        || state.actualBytes + chunk.byteLength > state.options.maxTotalBytes
      ) {
        discarded = true;
        chunks.length = 0;
        file.terminate();
        resolveCapture();
        return;
      }
      totalBytes += chunk.byteLength;
      state.actualBytes += chunk.byteLength;
      chunks.push(chunk.slice());
    }
    if (!final || discarded) return;

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const value of chunks) {
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    void gitBlobSha(bytes).then((blobSha) => {
      capturedFiles.set(path, { path, bytes, size: bytes.byteLength, blobSha });
      resolveCapture();
    }, rejectCapture ?? undefined);
  };

  try {
    file.start();
  } catch {
    resolveCapture();
  }
}

function parseArchiveEntryPath(
  archiveName: string,
  rootPrefix: { value: string | null }
): { path: string; directory: boolean } | null {
  if (!archiveName || archiveName.includes('\\') || archiveName.includes('\0') || archiveName.startsWith('/')) {
    throw new PublicRepositoryFallbackError('zip_invalid', `Invalid ZIP entry path: ${archiveName}`);
  }
  const directory = archiveName.endsWith('/');
  const segments = archiveName.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new PublicRepositoryFallbackError('zip_invalid', `Invalid ZIP entry path: ${archiveName}`);
  }

  const archiveRoot = segments[0];
  if (rootPrefix.value === null) rootPrefix.value = archiveRoot;
  if (rootPrefix.value !== archiveRoot) {
    throw new PublicRepositoryFallbackError('zip_invalid', 'ZIP archive contains multiple repository roots');
  }
  if (segments.length === 1) return null;

  return {
    path: normalizeRepositoryPath(segments.slice(1).join('/')),
    directory,
  };
}

export function isGitHubPublicFallbackEnabled(value: string | undefined): boolean {
  return value !== '0';
}

export class PublicGitHubRepositoryReader {
  private readonly fetchImpl: typeof fetch;
  private readonly useCache: boolean;
  private readonly maxZipBytes: number;
  private readonly maxEntries: number;
  private readonly maxHtmlPages: number;
  private readonly htmlConcurrency: number;
  private readonly maxHtmlBytes: number;
  private readonly fetchTimeoutMs: number;
  private readonly expectedHeadSha: string | null;
  private readonly waitUntil: ((promise: Promise<unknown>) => void) | null;
  private metadataPromise: Promise<PublicGitHubRepositoryMetadata | null> | null = null;
  // Snapshots are memoized per capture scope: entries are capture-independent,
  // but capturedFiles only cover the requested basePath, so distinct capture
  // scopes must not share a single snapshot promise.
  private readonly snapshotPromises = new Map<string, Promise<PublicRepositorySnapshot>>();
  private readonly filePromises = new Map<string, Promise<PublicRepositoryFile | null>>();

  constructor(
    private readonly requestedOwner: string,
    private readonly requestedRepo: string,
    options: PublicGitHubRepositoryReaderOptions = {}
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.useCache = options.cache ?? true;
    this.maxZipBytes = options.maxZipBytes ?? PUBLIC_REPOSITORY_DEFAULT_LIMITS.maxZipBytes;
    this.maxEntries = options.maxEntries ?? PUBLIC_REPOSITORY_DEFAULT_LIMITS.maxEntries;
    this.maxHtmlPages = options.maxHtmlPages ?? PUBLIC_REPOSITORY_DEFAULT_LIMITS.maxHtmlPages;
    this.htmlConcurrency = Math.max(1, Math.min(
      3,
      options.htmlConcurrency ?? PUBLIC_REPOSITORY_DEFAULT_LIMITS.htmlConcurrency
    ));
    this.maxHtmlBytes = options.maxHtmlBytes ?? MAX_HTML_BYTES;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
    this.waitUntil = options.waitUntil ?? null;
    this.expectedHeadSha = options.expectedHeadSha?.toLowerCase() ?? null;
    if (this.expectedHeadSha && !isCommitSha(this.expectedHeadSha)) {
      throw new PublicRepositoryFallbackError(
        'commit_mismatch',
        `Invalid expected GitHub commit SHA: ${options.expectedHeadSha}`
      );
    }
  }

  async getMetadata(): Promise<PublicGitHubRepositoryMetadata | null> {
    if (!this.metadataPromise) {
      this.metadataPromise = this.loadMetadata();
    }
    return this.metadataPromise;
  }

  async getSnapshot(
    capture?: PublicRepositoryCaptureOptions
  ): Promise<PublicRepositorySnapshot> {
    // Distinguish "no capture" (undefined) from a whole-repo capture
    // (basePath: null); both would otherwise collapse into the '' key even
    // though they produce different capturedFiles.
    const captureKey = capture === undefined ? '' : `@c:${capture.basePath ?? ''}`;
    let promise = this.snapshotPromises.get(captureKey);
    if (!promise) {
      promise = this.loadSnapshot(capture);
      this.snapshotPromises.set(captureKey, promise);
    }
    return promise;
  }

  async getFile(path: string, maxBytes: number): Promise<PublicRepositoryFile | null> {
    const normalizedPath = normalizeRepositoryPath(path);
    if (!normalizedPath) return null;

    for (const snapshotPromise of this.snapshotPromises.values()) {
      let snapshot: PublicRepositorySnapshot;
      try {
        snapshot = await snapshotPromise;
      } catch {
        // A failed snapshot for another capture scope must not block raw reads.
        continue;
      }
      const captured = snapshot.capturedFiles.get(normalizedPath);
      if (captured) {
        if (captured.size > maxBytes) {
          throw new PublicRepositoryFileTooLargeError(normalizedPath, maxBytes);
        }
        return captured;
      }
    }

    const key = `${normalizedPath}:${maxBytes}`;
    let promise = this.filePromises.get(key);
    if (!promise) {
      promise = this.loadRawFile(normalizedPath, maxBytes);
      this.filePromises.set(key, promise);
    }
    return promise;
  }

  /**
   * Write to Cache API without blocking the caller when an execution context
   * is available; writeJsonCache swallows its own errors, so the detached
   * promise cannot produce unhandled rejections.
   */
  private scheduleCacheWrite(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const write = writeJsonCache(key, value, ttlSeconds);
    if (!this.waitUntil) return write;
    try {
      this.waitUntil(write);
    } catch {
      // waitUntil throws when the execution context is already closed; cache
      // writes are best-effort, so fall back to the write promise itself
      // (writeJsonCache swallows its own errors) instead of breaking the
      // main path.
      return write;
    }
    return Promise.resolve();
  }

  async getLatestCommitAt(path: string): Promise<number | null> {
    const metadata = await this.requireMetadata();
    const normalizedPath = normalizeRepositoryPath(path);
    if (!normalizedPath) return null;

    const cacheKey = `${CACHE_NAMESPACE}/${CACHE_SCHEMA_VERSION}/commit/${encodeURIComponent(metadata.ownerLogin)}/${encodeURIComponent(metadata.name)}/${metadata.headSha}?path=${encodeURIComponent(normalizedPath)}`;
    if (this.useCache) {
      const cached = await readJsonCache(cacheKey, (value): value is { timestamp: number | null } => {
        const record = asRecord(value);
        return !!record && (record.timestamp === null || typeof record.timestamp === 'number');
      });
      if (cached) return cached.timestamp;
    }

    const url = `https://github.com/${encodeURIComponent(metadata.ownerLogin)}/${encodeURIComponent(metadata.name)}/commits/${metadata.headSha}/${encodePath(normalizedPath)}.atom`;
    const request = await this.publicFetch(url, {
      headers: { Accept: 'application/atom+xml' },
    });
    const { response } = request;
    try {
      if (response.status === 404) {
        await cancelBody(response);
        return null;
      }
      if (!response.ok) {
        await cancelBody(response);
        throw new PublicRepositoryFallbackError(
          'request_failed',
          `GitHub Atom commit feed failed with ${response.status}`,
          { status: response.status }
        );
      }

      const bytes = await readBytesLimited(response, this.maxHtmlBytes, normalizedPath);
      const xml = new TextDecoder().decode(bytes);
      const entryStart = xml.indexOf('<entry>');
      const entryEnd = entryStart >= 0 ? xml.indexOf('</entry>', entryStart) : -1;
      let timestamp: number | null = null;
      if (entryStart >= 0 && entryEnd > entryStart) {
        const entryXml = xml.slice(entryStart, entryEnd);
        const updatedMatch = entryXml.match(/<updated>([^<]+)<\/updated>/i);
        const parsed = updatedMatch?.[1] ? Date.parse(updatedMatch[1]) : Number.NaN;
        timestamp = Number.isFinite(parsed) ? parsed : null;
      }

      if (this.useCache) {
        await this.scheduleCacheWrite(cacheKey, { timestamp }, COMMIT_CACHE_TTL_SECONDS);
      }
      return timestamp;
    } finally {
      request.release();
    }
  }

  private async publicFetch(url: string, init: RequestInit = {}): Promise<TimedPublicResponse> {
    const headers = new Headers(init.headers ?? {});
    headers.delete('Authorization');
    headers.delete('Cookie');
    if (!headers.has('User-Agent')) headers.set('User-Agent', 'SkillsCat/1.0');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timeout);
    };
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers,
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal,
      });
      return { response, release };
    } catch (cause) {
      release();
      throw new PublicRepositoryFallbackError(
        'request_failed',
        `Public GitHub request failed: ${url}`,
        { cause }
      );
    }
  }

  private assertExpectedHeadSha(metadata: PublicGitHubRepositoryMetadata): void {
    if (
      this.expectedHeadSha
      && metadata.headSha.toLowerCase() !== this.expectedHeadSha
    ) {
      throw new PublicRepositoryFallbackError(
        'commit_mismatch',
        `Repository HEAD changed while reading ${metadata.ownerLogin}/${metadata.name}`
      );
    }
  }

  private async loadMetadata(): Promise<PublicGitHubRepositoryMetadata | null> {
    const cacheKey = `${CACHE_NAMESPACE}/${CACHE_SCHEMA_VERSION}/repo/${encodeURIComponent(this.requestedOwner.toLowerCase())}/${encodeURIComponent(this.requestedRepo.toLowerCase())}`;
    if (this.useCache) {
      const cached = await readJsonCache(cacheKey, isMetadata);
      if (
        cached
        && (!this.expectedHeadSha || cached.headSha.toLowerCase() === this.expectedHeadSha)
      ) {
        return cached;
      }
    }

    const url = `https://github.com/${encodeURIComponent(this.requestedOwner)}/${encodeURIComponent(this.requestedRepo)}`;
    const request = await this.publicFetch(url, { headers: { Accept: 'text/html' } });
    const { response } = request;
    try {
      if (response.status === 404) {
        await cancelBody(response);
        return null;
      }
      if (!response.ok) {
        await cancelBody(response);
        throw new PublicRepositoryFallbackError(
          'request_failed',
          `GitHub repository HTML failed with ${response.status}`,
          { status: response.status }
        );
      }

      const bytes = await readBytesLimited(response, this.maxHtmlBytes, `${this.requestedOwner}/${this.requestedRepo}`);
      const metadata = parsePublicGitHubRepositoryHtml(
        new TextDecoder().decode(bytes),
        this.requestedOwner,
        this.requestedRepo
      );
      this.assertExpectedHeadSha(metadata);
      if (this.useCache) {
        await this.scheduleCacheWrite(cacheKey, metadata, REPO_CACHE_TTL_SECONDS);
      }
      return metadata;
    } finally {
      request.release();
    }
  }

  private async requireMetadata(): Promise<PublicGitHubRepositoryMetadata> {
    const metadata = await this.getMetadata();
    if (!metadata) {
      throw new PublicRepositoryFallbackError(
        'not_public',
        `Public GitHub repository not found: ${this.requestedOwner}/${this.requestedRepo}`,
        { status: 404 }
      );
    }
    return metadata;
  }

  private async loadSnapshot(
    capture?: PublicRepositoryCaptureOptions
  ): Promise<PublicRepositorySnapshot> {
    const metadata = await this.requireMetadata();
    const cacheKey = `${CACHE_NAMESPACE}/${CACHE_SCHEMA_VERSION}/snapshot/${encodeURIComponent(metadata.ownerLogin.toLowerCase())}/${encodeURIComponent(metadata.name.toLowerCase())}/${metadata.headSha}`;
    if (this.useCache) {
      const cached = await readJsonCache(cacheKey, isCachedSnapshot);
      if (cached) {
        return {
          metadata,
          source: cached.source,
          entries: cached.entries,
          truncated: cached.truncated,
          capturedFiles: new Map(),
          diagnostics: { ...cached.diagnostics, cacheHit: true },
        };
      }
    }

    let snapshot: PublicRepositorySnapshot;
    try {
      snapshot = await this.loadZipSnapshot(metadata, capture);
    } catch (zipError) {
      const fallbackReason = zipError instanceof PublicRepositoryFallbackError
        ? zipError.reason
        : 'zip_invalid';
      snapshot = await this.loadHtmlSnapshot(metadata, fallbackReason);
    }

    if (this.useCache) {
      const cached: CachedSnapshot = {
        source: snapshot.source,
        entries: snapshot.entries,
        truncated: snapshot.truncated,
        diagnostics: {
          zipBytes: snapshot.diagnostics.zipBytes,
          htmlPages: snapshot.diagnostics.htmlPages,
          zipFallbackReason: snapshot.diagnostics.zipFallbackReason,
        },
      };
      await this.scheduleCacheWrite(cacheKey, cached, SNAPSHOT_CACHE_TTL_SECONDS);
    }
    return snapshot;
  }

  private async loadZipSnapshot(
    metadata: PublicGitHubRepositoryMetadata,
    capture?: PublicRepositoryCaptureOptions
  ): Promise<PublicRepositorySnapshot> {
    const url = `https://codeload.github.com/${encodeURIComponent(metadata.ownerLogin)}/${encodeURIComponent(metadata.name)}/zip/${metadata.headSha}`;
    const request = await this.publicFetch(url, {
      headers: { Accept: 'application/zip' },
    });
    try {
      return await this.readZipSnapshotResponse(request.response, metadata, capture);
    } finally {
      request.release();
    }
  }

  private async readZipSnapshotResponse(
    response: Response,
    metadata: PublicGitHubRepositoryMetadata,
    capture?: PublicRepositoryCaptureOptions
  ): Promise<PublicRepositorySnapshot> {
    if (!response.ok) {
      await cancelBody(response);
      throw new PublicRepositoryFallbackError(
        'request_failed',
        `GitHub codeload failed with ${response.status}`,
        { status: response.status }
      );
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > this.maxZipBytes) {
      await cancelBody(response);
      throw new PublicRepositoryFallbackError(
        'zip_too_large',
        `GitHub ZIP exceeds ${this.maxZipBytes} bytes`
      );
    }
    if (!response.body) {
      throw new PublicRepositoryFallbackError('request_failed', 'GitHub codeload response has no body');
    }

    const reader = response.body.getReader();
    const entries = new Map<string, PublicRepositoryEntry>();
    const capturedFiles = new Map<string, PublicRepositoryFile>();
    const pendingCaptures: Promise<void>[] = [];
    const rootPrefix = { value: null as string | null };
    const captureState = capture ? {
      options: capture,
      selectedFiles: 0,
      reservedBytes: 0,
      actualBytes: 0,
    } satisfies CaptureState : null;
    let archiveBytes = 0;
    let entryCount = 0;
    let archiveError: unknown = null;

    const unzip = new Unzip((file) => {
      if (archiveError) return;
      try {
        entryCount++;
        if (entryCount > this.maxEntries) {
          throw new PublicRepositoryFallbackError(
            'entry_limit',
            `GitHub ZIP exceeds ${this.maxEntries} entries`
          );
        }

        const parsed = parseArchiveEntryPath(file.name, rootPrefix);
        if (!parsed) return;
        const size = typeof file.originalSize === 'number' && Number.isFinite(file.originalSize)
          ? Math.max(0, Math.trunc(file.originalSize))
          : undefined;
        const entry: PublicRepositoryEntry = parsed.directory
          ? { path: parsed.path, type: 'tree' }
          : { path: parsed.path, type: 'blob', ...(size === undefined ? {} : { size }) };
        if (!addEntryWithParents(entries, entry, this.maxEntries)) {
          throw new PublicRepositoryFallbackError(
            'entry_limit',
            `GitHub ZIP exceeds ${this.maxEntries} entries including parent directories`
          );
        }

        if (!parsed.directory && captureState) {
          captureZipFile(file, parsed.path, captureState, capturedFiles, pendingCaptures);
        }
      } catch (cause) {
        archiveError = cause;
      }
    });
    unzip.register(UnzipInflate);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        archiveBytes += value.byteLength;
        if (archiveBytes > this.maxZipBytes) {
          throw new PublicRepositoryFallbackError(
            'zip_too_large',
            `GitHub ZIP exceeds ${this.maxZipBytes} bytes`
          );
        }

        for (let offset = 0; offset < value.byteLength; offset += ZIP_PUSH_CHUNK_BYTES) {
          unzip.push(value.subarray(offset, Math.min(value.byteLength, offset + ZIP_PUSH_CHUNK_BYTES)));
          if (archiveError) throw archiveError;
        }
      }
      unzip.push(new Uint8Array(0), true);
      if (archiveError) throw archiveError;
      await Promise.all(pendingCaptures);
    } catch (cause) {
      try {
        await reader.cancel();
      } catch {
        // The connection may already be closed.
      }
      // In-flight captures never settle once the stream is abandoned; subscribe
      // without awaiting so a late inflate rejection cannot surface as an
      // unhandled rejection.
      void Promise.allSettled(pendingCaptures);
      if (cause instanceof PublicRepositoryFallbackError) throw cause;
      throw new PublicRepositoryFallbackError('zip_invalid', 'GitHub ZIP could not be parsed', { cause });
    }

    if (entries.size === 0) {
      throw new PublicRepositoryFallbackError('zip_invalid', 'GitHub ZIP contained no repository entries');
    }
    for (const [path, captured] of capturedFiles) {
      const entry = entries.get(path);
      if (entry?.type === 'blob') {
        entry.sha = captured.blobSha;
        entry.size = captured.size;
      }
    }

    return {
      metadata,
      source: 'zip',
      entries: sortEntries(entries.values()),
      truncated: false,
      capturedFiles,
      diagnostics: {
        cacheHit: false,
        zipBytes: archiveBytes,
      },
    };
  }

  private async loadHtmlSnapshot(
    metadata: PublicGitHubRepositoryMetadata,
    zipFallbackReason: PublicRepositoryFallbackReason
  ): Promise<PublicRepositorySnapshot> {
    const entries = new Map<string, PublicRepositoryEntry>();
    const queuedDirectories = new Set<string>();
    let queue: string[] = [];
    let pages = 1;
    let truncated = metadata.rootTotalCount > metadata.rootEntries.length;

    for (const entry of metadata.rootEntries) {
      if (!addEntryWithParents(entries, entry, this.maxEntries)) {
        truncated = true;
        break;
      }
      if (entry.type === 'tree' && !queuedDirectories.has(entry.path)) {
        queuedDirectories.add(entry.path);
        queue.push(entry.path);
      }
    }

    while (queue.length > 0 && pages < this.maxHtmlPages && entries.size < this.maxEntries) {
      const remainingPages = this.maxHtmlPages - pages;
      const batch = queue.splice(0, Math.min(this.htmlConcurrency, remainingPages));
      const results = await Promise.all(batch.map(async (path) => ({
        expectedPath: path,
        page: await this.loadTreePage(metadata, path),
      })));
      pages += results.length;

      for (const result of results) {
        const page = result.page;
        if (page.headSha.toLowerCase() !== metadata.headSha.toLowerCase()) {
          throw new PublicRepositoryFallbackError(
            'commit_mismatch',
            'GitHub tree page did not match the pinned commit'
          );
        }
        if (page.path !== result.expectedPath) {
          throw new PublicRepositoryFallbackError(
            'schema_changed',
            'GitHub tree page did not match the requested path'
          );
        }
        if (page.totalCount > page.entries.length) truncated = true;
        for (const entry of page.entries) {
          if (!addEntryWithParents(entries, entry, this.maxEntries)) {
            truncated = true;
            break;
          }
          if (entry.type === 'tree' && !queuedDirectories.has(entry.path)) {
            queuedDirectories.add(entry.path);
            queue.push(entry.path);
          }
        }
      }
    }

    if (queue.length > 0) truncated = true;
    return {
      metadata,
      source: 'html',
      entries: sortEntries(entries.values()),
      truncated,
      capturedFiles: new Map(),
      diagnostics: {
        cacheHit: false,
        htmlPages: pages,
        zipFallbackReason,
      },
    };
  }

  private async loadTreePage(
    metadata: PublicGitHubRepositoryMetadata,
    path: string
  ): Promise<ParsedTreePage> {
    const url = `https://github.com/${encodeURIComponent(metadata.ownerLogin)}/${encodeURIComponent(metadata.name)}/tree/${metadata.headSha}/${encodePath(path)}`;
    const request = await this.publicFetch(url, { headers: { Accept: 'text/html' } });
    const { response } = request;
    try {
      if (!response.ok) {
        await cancelBody(response);
        throw new PublicRepositoryFallbackError(
          'request_failed',
          `GitHub tree HTML failed with ${response.status}: ${path}`,
          { status: response.status }
        );
      }
      const bytes = await readBytesLimited(response, this.maxHtmlBytes, path);
      return parsePublicGitHubTreeHtml(new TextDecoder().decode(bytes));
    } finally {
      request.release();
    }
  }

  private async loadRawFile(
    path: string,
    maxBytes: number
  ): Promise<PublicRepositoryFile | null> {
    const metadata = await this.requireMetadata();
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(metadata.ownerLogin)}/${encodeURIComponent(metadata.name)}/${metadata.headSha}/${encodePath(path)}`;
    const request = await this.publicFetch(url, { headers: { Accept: 'application/octet-stream' } });
    const { response } = request;
    try {
      if (response.status === 404) {
        await cancelBody(response);
        return null;
      }
      if (!response.ok) {
        await cancelBody(response);
        throw new PublicRepositoryFallbackError(
          'request_failed',
          `GitHub raw file failed with ${response.status}: ${path}`,
          { status: response.status }
        );
      }

      const bytes = await readBytesLimited(response, maxBytes, path);
      return {
        path,
        bytes,
        size: bytes.byteLength,
        blobSha: await gitBlobSha(bytes),
      };
    } finally {
      request.release();
    }
  }
}
