import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getCacheDir } from '../config/config';

const GITHUB_CACHE_VERSION = 1;
const TREE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_TREE_CACHE_ITEMS = 100;
const MAX_BLOB_CACHE_ITEMS = 1000;
const PRUNE_PERCENTAGE = 0.2;

type TreeEntry = {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  mode?: string;
};

interface CacheRecordBase {
  version: number;
  cachedAt: number;
  lastAccessedAt: number;
}

interface TreeCacheRecord extends CacheRecordBase {
  tree: TreeEntry[];
}

interface BlobCacheRecord extends CacheRecordBase {
  dataBase64: string;
}

function getGitHubCacheDir(): string {
  return join(getCacheDir(), 'github');
}

function getTreeCacheDir(): string {
  return join(getGitHubCacheDir(), 'trees');
}

function getBlobCacheDir(): string {
  return join(getGitHubCacheDir(), 'blobs');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function ensureGitHubCacheDirs(): void {
  ensureDir(getTreeCacheDir());
  ensureDir(getBlobCacheDir());
}

function toCacheFileName(prefix: string, key: string): string {
  const digest = createHash('sha256').update(key).digest('hex');
  return `${prefix}-${digest}.json`;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(value));
}

function hasValidCacheRecordBase(record: Partial<CacheRecordBase> | null | undefined): record is CacheRecordBase {
  return !!record
    && record.version === GITHUB_CACHE_VERSION
    && typeof record.cachedAt === 'number'
    && typeof record.lastAccessedAt === 'number';
}

function isValidTreeCacheRecord(record: Partial<TreeCacheRecord> | null | undefined): record is TreeCacheRecord {
  if (!record || !hasValidCacheRecordBase(record)) {
    return false;
  }
  const treeRecord = record as Partial<TreeCacheRecord>;
  return Array.isArray(treeRecord.tree);
}

function isValidBlobCacheRecord(record: Partial<BlobCacheRecord> | null | undefined): record is BlobCacheRecord {
  if (!record || !hasValidCacheRecordBase(record)) {
    return false;
  }
  const blobRecord = record as Partial<BlobCacheRecord>;
  return typeof blobRecord.dataBase64 === 'string';
}

function touchCacheRecord(filePath: string, record: CacheRecordBase & Record<string, unknown>): void {
  try {
    record.lastAccessedAt = Date.now();
    writeFileSync(filePath, JSON.stringify(record));
  } catch {
    // Best effort only
  }
}

function pruneCacheDir(dir: string, maxItems: number): void {
  try {
    ensureDir(dir);
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
    if (files.length <= maxItems) return;

    const sortable: Array<{ file: string; lastAccessedAt: number }> = [];
    for (const file of files) {
      const record = readJsonFile<Partial<CacheRecordBase>>(join(dir, file));
      sortable.push({
        file,
        lastAccessedAt: hasValidCacheRecordBase(record) ? record.lastAccessedAt : 0,
      });
    }

    sortable.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const toRemove = Math.max(1, Math.ceil(files.length * PRUNE_PERCENTAGE));
    for (const item of sortable.slice(0, toRemove)) {
      try {
        unlinkSync(join(dir, item.file));
      } catch {
        // ignore individual file failures
      }
    }
  } catch {
    // ignore prune errors
  }
}

function getTreeCachePath(owner: string, repo: string, ref: string): string {
  const key = `${owner}/${repo}@${ref}`;
  return join(getTreeCacheDir(), toCacheFileName('tree', key));
}

function getBlobCachePath(sha: string): string {
  return join(getBlobCacheDir(), toCacheFileName('blob', sha));
}

export function getCachedGitHubTree(owner: string, repo: string, ref: string): TreeEntry[] | null {
  try {
    const filePath = getTreeCachePath(owner, repo, ref);
    const record = readJsonFile<Partial<TreeCacheRecord>>(filePath);
    if (!isValidTreeCacheRecord(record)) {
      return null;
    }

    if (Date.now() - record.cachedAt > TREE_CACHE_TTL_MS) {
      return null;
    }

    touchCacheRecord(filePath, record as TreeCacheRecord & Record<string, unknown>);
    return record.tree.map((item) => ({ ...item }));
  } catch {
    return null;
  }
}

export function cacheGitHubTree(owner: string, repo: string, ref: string, tree: TreeEntry[]): void {
  try {
    ensureGitHubCacheDirs();
    const now = Date.now();
    const filePath = getTreeCachePath(owner, repo, ref);
    const record: TreeCacheRecord = {
      version: GITHUB_CACHE_VERSION,
      cachedAt: now,
      lastAccessedAt: now,
      tree: tree.map((item) => ({ ...item })),
    };
    writeJsonFile(filePath, record);
    pruneCacheDir(getTreeCacheDir(), MAX_TREE_CACHE_ITEMS);
  } catch {
    // ignore cache write errors
  }
}

export function getCachedGitHubBlob(sha: string): Buffer | null {
  try {
    const filePath = getBlobCachePath(sha);
    const record = readJsonFile<Partial<BlobCacheRecord>>(filePath);
    if (!isValidBlobCacheRecord(record)) {
      return null;
    }

    touchCacheRecord(filePath, record as BlobCacheRecord & Record<string, unknown>);
    return Buffer.from(record.dataBase64, 'base64');
  } catch {
    return null;
  }
}

export function cacheGitHubBlob(sha: string, bytes: Uint8Array): void {
  try {
    ensureGitHubCacheDirs();
    const now = Date.now();
    const filePath = getBlobCachePath(sha);
    const record: BlobCacheRecord = {
      version: GITHUB_CACHE_VERSION,
      cachedAt: now,
      lastAccessedAt: now,
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
    writeJsonFile(filePath, record);
    pruneCacheDir(getBlobCacheDir(), MAX_BLOB_CACHE_ITEMS);
  } catch {
    // ignore cache write errors
  }
}
