import {
  buildOpenClawResponseHeaders,
  OPENCLAW_DEFAULT_LIMIT,
  type OpenClawSort,
} from '$lib/server/openclaw/registry';
import type { OpenClawResolvedVersionState } from '$lib/server/openclaw/skill-state';
import {
  getCached,
  getCachedBinary,
  getCachedText,
  invalidateCache,
} from '$lib/server/cache';
import {
  getSkillPageCacheInvalidationKeys,
  PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
} from '$lib/server/cache/keys';

export interface OpenClawRouteCachePolicy {
  ttlSeconds: number;
  cacheControl: string;
}

type WaitUntilFn = (promise: Promise<unknown>) => void;
type OpenClawCacheStatus = 'HIT' | 'MISS' | 'BYPASS';
type OpenClawHeaders = Record<string, string>;

const OPENCLAW_CACHE_KEY_VERSION = 'v2';
const OPENCLAW_BROWSE_INVALIDATION_SORTS: OpenClawSort[] = [
  'updated',
  'downloads',
  'stars',
  'installsCurrent',
  'installsAllTime',
  'trending',
];
const OPENCLAW_DYNAMIC_CACHE_POLICY: OpenClawRouteCachePolicy = {
  ttlSeconds: 300,
  cacheControl: 'public, max-age=300, stale-while-revalidate=900',
};
const OPENCLAW_IMMUTABLE_CACHE_POLICY: OpenClawRouteCachePolicy = {
  ttlSeconds: 86400,
  cacheControl: 'public, max-age=86400, stale-while-revalidate=604800',
};

function encodeCacheSegment(value: string | number | null | undefined): string {
  return encodeURIComponent(String(value ?? ''));
}

function findLatestVersionEntry(
  state: OpenClawResolvedVersionState
): OpenClawResolvedVersionState['selectedVersion'] {
  return state.versions.find((entry) => entry.version === state.latestVersion.version) || state.selectedVersion;
}

export function canUsePublicOpenClawCache(cacheControl: string): boolean {
  return cacheControl.trim().toLowerCase().startsWith('public');
}

export function buildOpenClawCacheHeaders(input: {
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
}): OpenClawHeaders {
  return buildOpenClawResponseHeaders({
    cacheControl: input.cacheControl,
    cacheStatus: input.cacheStatus,
  });
}

export function getOpenClawRouteCachePolicy(options?: {
  immutable?: boolean;
}): OpenClawRouteCachePolicy {
  return options?.immutable ? OPENCLAW_IMMUTABLE_CACHE_POLICY : OPENCLAW_DYNAMIC_CACHE_POLICY;
}

export function isOpenClawImmutableVersionRequest(requestedVersion: string | null | undefined): boolean {
  return Boolean(requestedVersion?.trim());
}

export function getOpenClawVersionsStateToken(state: OpenClawResolvedVersionState): string {
  const latestEntry = findLatestVersionEntry(state);
  const latestFingerprint = latestEntry?.fingerprint || latestEntry?.createdAt || state.latestVersion.createdAt || 0;
  const manifestMarker = state.manifest?.updatedAt || state.latestVersion.createdAt || 0;

  return [
    encodeCacheSegment(manifestMarker),
    encodeCacheSegment(state.versions.length),
    encodeCacheSegment(state.latestVersion.version),
    encodeCacheSegment(latestFingerprint),
  ].join(':');
}

export function getOpenClawSelectedVersionContentToken(state: OpenClawResolvedVersionState): string {
  if (!state.selectedVersion) {
    return 'missing';
  }

  return [
    encodeCacheSegment(state.selectedVersion.version),
    encodeCacheSegment(state.selectedVersion.fingerprint || state.selectedVersion.createdAt || 0),
  ].join(':');
}

export function getOpenClawSelectedVersionMetadataToken(state: OpenClawResolvedVersionState): string {
  if (!state.selectedVersion) {
    return 'missing';
  }

  return [
    getOpenClawSelectedVersionContentToken(state),
    encodeCacheSegment(state.manifest?.updatedAt || state.selectedVersion.createdAt || 0),
  ].join(':');
}

export function buildOpenClawBrowseListCacheKey(input: {
  sort: OpenClawSort;
  limit: number;
  offset: number;
}): string {
  return [
    'openclaw:browse',
    OPENCLAW_CACHE_KEY_VERSION,
    encodeCacheSegment(input.sort),
    encodeCacheSegment(input.limit),
    encodeCacheSegment(input.offset),
  ].join(':');
}

export function buildOpenClawSkillDetailCacheKey(input: {
  compatSlug: string;
  skillUpdatedAt: number | null | undefined;
  versionsStateToken: string;
}): string {
  return [
    'openclaw:detail',
    OPENCLAW_CACHE_KEY_VERSION,
    encodeCacheSegment(input.compatSlug),
    encodeCacheSegment(input.skillUpdatedAt || 0),
    input.versionsStateToken,
  ].join(':');
}

export function buildOpenClawVersionsListCacheKey(input: {
  compatSlug: string;
  versionsStateToken: string;
}): string {
  return [
    'openclaw:versions',
    OPENCLAW_CACHE_KEY_VERSION,
    encodeCacheSegment(input.compatSlug),
    input.versionsStateToken,
  ].join(':');
}

export function buildOpenClawVersionDetailCacheKey(input: {
  compatSlug: string;
  skillUpdatedAt: number | null | undefined;
  selectedVersionMetadataToken: string;
}): string {
  return [
    'openclaw:version',
    OPENCLAW_CACHE_KEY_VERSION,
    encodeCacheSegment(input.compatSlug),
    encodeCacheSegment(input.skillUpdatedAt || 0),
    input.selectedVersionMetadataToken,
  ].join(':');
}

export function buildOpenClawFileCacheKey(input: {
  compatSlug: string;
  path: string;
  selectedVersionContentToken: string;
}): string {
  return [
    'openclaw:file',
    OPENCLAW_CACHE_KEY_VERSION,
    encodeCacheSegment(input.compatSlug),
    input.selectedVersionContentToken,
    encodeCacheSegment(input.path),
  ].join(':');
}

export function buildOpenClawDownloadCacheKey(input: {
  compatSlug: string;
  selectedVersionContentToken: string;
}): string {
  return [
    'openclaw:download',
    OPENCLAW_CACHE_KEY_VERSION,
    encodeCacheSegment(input.compatSlug),
    input.selectedVersionContentToken,
  ].join(':');
}

export function buildOpenClawResolveCacheKey(input: {
  compatSlug: string;
  hash: string;
  skillUpdatedAt: number | null | undefined;
  versionsStateToken: string;
}): string {
  return [
    'openclaw:resolve',
    OPENCLAW_CACHE_KEY_VERSION,
    encodeCacheSegment(input.compatSlug),
    encodeCacheSegment(input.skillUpdatedAt || 0),
    input.versionsStateToken,
    encodeCacheSegment(input.hash),
  ].join(':');
}

function buildOpenClawCacheResult<T>(input: {
  data: T;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
}): {
  data: T;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
  headers: OpenClawHeaders;
} {
  return {
    ...input,
    headers: buildOpenClawCacheHeaders({
      cacheControl: input.cacheControl,
      cacheStatus: input.cacheStatus,
    }),
  };
}

async function resolveOpenClawCacheWith<T>(input: {
  cacheKey: string;
  waitUntil?: WaitUntilFn;
  immutable?: boolean;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
  load: () => Promise<T>;
  reader: (cachePolicy: OpenClawRouteCachePolicy) => Promise<{ data: T; hit: boolean }>;
}): Promise<{
  data: T;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
  headers: OpenClawHeaders;
}> {
  if (!canUsePublicOpenClawCache(input.cacheControl)) {
    return buildOpenClawCacheResult({
      data: await input.load(),
      cacheControl: input.cacheControl,
      cacheStatus: input.cacheStatus,
    });
  }

  const cachePolicy = getOpenClawRouteCachePolicy({ immutable: input.immutable });
  const { data, hit } = await input.reader(cachePolicy);

  return buildOpenClawCacheResult({
    data,
    cacheControl: cachePolicy.cacheControl,
    cacheStatus: hit ? 'HIT' : 'MISS',
  });
}

export async function resolveOpenClawJsonCache<T>(input: {
  cacheKey: string;
  load: () => Promise<T>;
  waitUntil?: WaitUntilFn;
  immutable?: boolean;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
}): Promise<{
  data: T;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
  headers: OpenClawHeaders;
}> {
  return resolveOpenClawCacheWith({
    ...input,
    reader: (cachePolicy) =>
      getCached(
        input.cacheKey,
        input.load,
        cachePolicy.ttlSeconds,
        { waitUntil: input.waitUntil }
      ),
  });
}

export async function resolveOpenClawTextCache(input: {
  cacheKey: string;
  load: () => Promise<string>;
  waitUntil?: WaitUntilFn;
  immutable?: boolean;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
}): Promise<{
  data: string;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
  headers: OpenClawHeaders;
}> {
  return resolveOpenClawCacheWith({
    ...input,
    reader: (cachePolicy) =>
      getCachedText(
        input.cacheKey,
        input.load,
        cachePolicy.ttlSeconds,
        { waitUntil: input.waitUntil }
      ),
  });
}

export async function resolveOpenClawBinaryCache(input: {
  cacheKey: string;
  load: () => Promise<Uint8Array>;
  waitUntil?: WaitUntilFn;
  immutable?: boolean;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
  contentType?: string;
}): Promise<{
  data: Uint8Array;
  cacheControl: string;
  cacheStatus: OpenClawCacheStatus;
  headers: OpenClawHeaders;
}> {
  return resolveOpenClawCacheWith({
    ...input,
    reader: (cachePolicy) =>
      getCachedBinary(
        input.cacheKey,
        input.load,
        cachePolicy.ttlSeconds,
        {
          waitUntil: input.waitUntil,
          contentType: input.contentType,
        }
      ),
  });
}

export async function invalidateOpenClawSkillCaches(skillId: string, nativeSlug: string): Promise<void> {
  const cacheKeys = [
    `api:skill:${nativeSlug}`,
    `api:skill-files:${nativeSlug}`,
    `skill:${skillId}`,
    `recommend:${skillId}`,
    ...getSkillPageCacheInvalidationKeys(nativeSlug),
    ...PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
    ...OPENCLAW_BROWSE_INVALIDATION_SORTS.map((sort) =>
      buildOpenClawBrowseListCacheKey({
        sort,
        limit: OPENCLAW_DEFAULT_LIMIT,
        offset: 0,
      })
    ),
  ];

  await Promise.all(cacheKeys.map((cacheKey) => invalidateCache(cacheKey)));
}
