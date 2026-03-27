import { SITE_URL } from '$lib/seo/constants';
import { buildSkillPath } from '$lib/skill-path';

const DEFAULT_INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const DEFAULT_INDEXNOW_DEDUPE_TTL_SECONDS = 600;
const DEFAULT_INDEXNOW_KEY_LOCATION_PATH = '/indexnow.txt';
const INDEXNOW_DEDUPE_PREFIX = 'seo:indexnow:v1';
const MAX_URLS_PER_REQUEST = 10_000;

type WaitUntilFn = (promise: Promise<unknown>) => void;

export interface IndexNowEnvLike {
  INDEXNOW_ENABLED?: string;
  INDEXNOW_KEY?: string;
  INDEXNOW_KEY_LOCATION?: string;
  INDEXNOW_API_URL?: string;
  INDEXNOW_DEDUPE_TTL_SECONDS?: string;
  KV?: KVNamespace;
}

export interface IndexNowSkillTarget {
  slug: string;
  visibility?: string | null;
  orgSlug?: string | null;
  ownerHandle?: string | null;
}

interface LoadedSkillTargetRow {
  slug: string;
  visibility: string | null;
  orgSlug: string | null;
  repoOwner: string | null;
  ownerName: string | null;
}

export interface SubmitIndexNowUrlsOptions {
  env: IndexNowEnvLike | undefined;
  urls: string[];
  source: string;
  action?: 'update' | 'delete';
  waitUntil?: WaitUntilFn;
  fetchImpl?: typeof fetch;
}

export interface SubmitIndexNowUrlsResult {
  attempted: number;
  submitted: number;
  skipped: number;
  disabled: boolean;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  return defaultValue;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(numeric));
}

function isIndexNowEnabled(env: IndexNowEnvLike | undefined): boolean {
  const key = env?.INDEXNOW_KEY?.trim();
  if (!key) return false;
  return parseBooleanEnv(env?.INDEXNOW_ENABLED, true);
}

function getSiteOrigin(): string {
  return SITE_URL.replace(/\/+$/, '');
}

function getSiteHost(): string {
  return new URL(SITE_URL).host;
}

export function getIndexNowKeyLocation(env: Pick<IndexNowEnvLike, 'INDEXNOW_KEY_LOCATION'> | undefined): string {
  const configured = env?.INDEXNOW_KEY_LOCATION?.trim();
  if (!configured) {
    return `${getSiteOrigin()}${DEFAULT_INDEXNOW_KEY_LOCATION_PATH}`;
  }

  if (/^https?:\/\//i.test(configured)) {
    return configured;
  }

  return `${getSiteOrigin()}${configured.startsWith('/') ? configured : `/${configured}`}`;
}

function normalizeIndexNowUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  const url = raw.startsWith('http://') || raw.startsWith('https://')
    ? new URL(raw)
    : new URL(raw, SITE_URL);
  const siteUrl = new URL(SITE_URL);

  if (url.host !== siteUrl.host) return null;
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.pathname === '/search' || url.pathname.startsWith('/api/')) return null;

  url.hash = '';
  return url.toString();
}

function chunkUrls(urls: string[]): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < urls.length; index += MAX_URLS_PER_REQUEST) {
    chunks.push(urls.slice(index, index + MAX_URLS_PER_REQUEST));
  }

  return chunks;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function filterFreshUrls(
  kv: KVNamespace | undefined,
  urls: string[],
  action: 'update' | 'delete'
): Promise<{ freshUrls: string[]; dedupeKeys: string[] }> {
  if (!kv || urls.length === 0) {
    return { freshUrls: urls, dedupeKeys: [] };
  }

  const freshUrls: string[] = [];
  const dedupeKeys: string[] = [];

  for (const url of urls) {
    const dedupeKey = `${INDEXNOW_DEDUPE_PREFIX}:${action}:${await sha256Hex(url)}`;
    const existing = await kv.get(dedupeKey);
    if (existing) {
      continue;
    }
    freshUrls.push(url);
    dedupeKeys.push(dedupeKey);
  }

  return { freshUrls, dedupeKeys };
}

async function markFreshUrlsSubmitted(
  kv: KVNamespace | undefined,
  dedupeKeys: string[],
  ttlSeconds: number
): Promise<void> {
  if (!kv || dedupeKeys.length === 0) return;

  await Promise.all(
    dedupeKeys.map((dedupeKey) => kv.put(dedupeKey, '1', { expirationTtl: ttlSeconds }))
  );
}

export function buildIndexNowSkillUrls(skill: IndexNowSkillTarget): string[] {
  if (skill.visibility && skill.visibility !== 'public') {
    return [];
  }

  const urls = new Set<string>();
  urls.add(`${getSiteOrigin()}${buildSkillPath(skill.slug)}`);

  if (skill.orgSlug) {
    urls.add(`${getSiteOrigin()}/org/${encodeURIComponent(skill.orgSlug)}`);
  } else if (skill.ownerHandle) {
    urls.add(`${getSiteOrigin()}/u/${encodeURIComponent(skill.ownerHandle)}`);
  }

  return [...urls];
}

export async function loadIndexNowSkillTarget(
  db: D1Database | undefined,
  skillId: string
): Promise<IndexNowSkillTarget | null> {
  if (!db || !skillId) return null;

  const row = await db.prepare(`
    SELECT
      s.slug AS slug,
      s.visibility AS visibility,
      o.slug AS orgSlug,
      s.repo_owner AS repoOwner,
      u.name AS ownerName
    FROM skills s
    LEFT JOIN organizations o ON o.id = s.org_id
    LEFT JOIN user u ON u.id = s.owner_id
    WHERE s.id = ?
    LIMIT 1
  `)
    .bind(skillId)
    .first<LoadedSkillTargetRow>();

  if (!row?.slug) {
    return null;
  }

  const ownerHandle = row.orgSlug ? null : (row.repoOwner || row.ownerName || null);

  return {
    slug: row.slug,
    visibility: row.visibility,
    orgSlug: row.orgSlug,
    ownerHandle,
  };
}

export async function submitIndexNowUrls(
  options: SubmitIndexNowUrlsOptions
): Promise<SubmitIndexNowUrlsResult> {
  const { env, urls, source, action = 'update', fetchImpl = fetch } = options;
  const normalized = Array.from(new Set(urls.map(normalizeIndexNowUrl).filter((url): url is string => Boolean(url))));

  if (!isIndexNowEnabled(env)) {
    return {
      attempted: normalized.length,
      submitted: 0,
      skipped: normalized.length,
      disabled: true,
    };
  }

  if (normalized.length === 0) {
    return {
      attempted: 0,
      submitted: 0,
      skipped: 0,
      disabled: false,
    };
  }

  const { freshUrls, dedupeKeys } = await filterFreshUrls(env?.KV, normalized, action);
  if (freshUrls.length === 0) {
    return {
      attempted: normalized.length,
      submitted: 0,
      skipped: normalized.length,
      disabled: false,
    };
  }

  const endpoint = env?.INDEXNOW_API_URL?.trim() || DEFAULT_INDEXNOW_ENDPOINT;
  const key = env?.INDEXNOW_KEY?.trim();
  const keyLocation = getIndexNowKeyLocation(env);
  const ttlSeconds = parsePositiveInt(
    env?.INDEXNOW_DEDUPE_TTL_SECONDS,
    DEFAULT_INDEXNOW_DEDUPE_TTL_SECONDS
  );

  for (const urlChunk of chunkUrls(freshUrls)) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        host: getSiteHost(),
        key,
        keyLocation,
        urlList: urlChunk,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(
        `IndexNow submission failed for ${source}: ${response.status} ${response.statusText}${responseText ? ` - ${responseText.slice(0, 200)}` : ''}`
      );
    }
  }

  await markFreshUrlsSubmitted(env?.KV, dedupeKeys, ttlSeconds);
  console.log(
    `IndexNow submission succeeded for ${source}: action=${action}, submitted=${freshUrls.length}, skipped=${normalized.length - freshUrls.length}`
  );

  return {
    attempted: normalized.length,
    submitted: freshUrls.length,
    skipped: normalized.length - freshUrls.length,
    disabled: false,
  };
}

export function scheduleIndexNowSubmission(options: SubmitIndexNowUrlsOptions): Promise<SubmitIndexNowUrlsResult> | void {
  const task = submitIndexNowUrls(options).catch((error) => {
    console.error(`IndexNow submission failed for ${options.source}:`, error);
    return {
      attempted: options.urls.length,
      submitted: 0,
      skipped: options.urls.length,
      disabled: false,
    } satisfies SubmitIndexNowUrlsResult;
  });

  if (options.waitUntil) {
    options.waitUntil(task);
    return;
  }

  return task;
}
