import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir } from './config.js';

const MAX_CACHE_ITEMS = 100;
const PRUNE_PERCENTAGE = 0.2;

export interface CachedSkill {
  content: string;
  contentHash: string;
  commitSha?: string;
  cachedAt: number;
  lastAccessedAt: number;
  source: 'github' | 'registry';
}

interface CacheIndex {
  skills: Record<string, { lastAccessedAt: number }>;
}

/**
 * Get the skills cache directory
 */
export function getSkillsCacheDir(): string {
  return join(getCacheDir(), 'skills');
}

/**
 * Get the cache index file path
 */
function getCacheIndexPath(): string {
  return join(getCacheDir(), 'index.json');
}

/**
 * Ensure cache directories exist
 */
function ensureCacheDir(): void {
  const skillsDir = getSkillsCacheDir();
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }
}

/**
 * Generate a cache key from skill identifier
 */
export function getCacheKey(owner: string, repo: string, skillPath?: string): string {
  const pathPart = skillPath ? skillPath.replace(/\//g, '_').replace(/\.md$/i, '') : 'root';
  return `${owner}_${repo}_${pathPart}`;
}

/**
 * Calculate SHA256 content hash
 */
export function calculateContentHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

/**
 * Load the cache index
 */
function loadCacheIndex(): CacheIndex {
  try {
    const indexPath = getCacheIndexPath();
    if (existsSync(indexPath)) {
      return JSON.parse(readFileSync(indexPath, 'utf-8')) as CacheIndex;
    }
  } catch {
    // Ignore errors
  }
  return { skills: {} };
}

/**
 * Save the cache index
 */
function saveCacheIndex(index: CacheIndex): void {
  ensureCacheDir();
  writeFileSync(getCacheIndexPath(), JSON.stringify(index, null, 2));
}

/**
 * Get cached skill if valid
 */
export function getCachedSkill(owner: string, repo: string, skillPath?: string): CachedSkill | null {
  try {
    const key = getCacheKey(owner, repo, skillPath);
    const filePath = join(getSkillsCacheDir(), `${key}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    const cached = JSON.parse(readFileSync(filePath, 'utf-8')) as CachedSkill;

    // Update last accessed time
    cached.lastAccessedAt = Date.now();
    writeFileSync(filePath, JSON.stringify(cached, null, 2));

    // Update index
    const index = loadCacheIndex();
    index.skills[key] = { lastAccessedAt: cached.lastAccessedAt };
    saveCacheIndex(index);

    return cached;
  } catch {
    return null;
  }
}

/**
 * Cache a skill
 */
export function cacheSkill(
  owner: string,
  repo: string,
  content: string,
  source: 'github' | 'registry',
  skillPath?: string,
  commitSha?: string
): void {
  try {
    ensureCacheDir();

    const key = getCacheKey(owner, repo, skillPath);
    const filePath = join(getSkillsCacheDir(), `${key}.json`);
    const now = Date.now();

    const cached: CachedSkill = {
      content,
      contentHash: calculateContentHash(content),
      commitSha,
      cachedAt: now,
      lastAccessedAt: now,
      source
    };

    writeFileSync(filePath, JSON.stringify(cached, null, 2));

    // Update index
    const index = loadCacheIndex();
    index.skills[key] = { lastAccessedAt: now };
    saveCacheIndex(index);

    // Prune if needed
    pruneCache();
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Check if cached skill is valid by comparing hashes
 */
export function isSkillCacheValid(
  owner: string,
  repo: string,
  remoteHash: string,
  skillPath?: string
): boolean {
  const cached = getCachedSkill(owner, repo, skillPath);
  if (!cached) return false;
  return cached.contentHash === remoteHash;
}

/**
 * Clear all cached skills
 */
export function clearCache(): void {
  try {
    const skillsDir = getSkillsCacheDir();
    if (existsSync(skillsDir)) {
      const files = readdirSync(skillsDir);
      for (const file of files) {
        unlinkSync(join(skillsDir, file));
      }
    }

    // Clear index
    const indexPath = getCacheIndexPath();
    if (existsSync(indexPath)) {
      unlinkSync(indexPath);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Prune cache to stay under MAX_CACHE_ITEMS
 * Removes oldest 20% when limit is exceeded
 */
export function pruneCache(maxItems: number = MAX_CACHE_ITEMS): void {
  try {
    const index = loadCacheIndex();
    const keys = Object.keys(index.skills);

    if (keys.length <= maxItems) {
      return;
    }

    // Sort by lastAccessedAt (oldest first)
    const sorted = keys.sort((a, b) => {
      return (index.skills[a]?.lastAccessedAt || 0) - (index.skills[b]?.lastAccessedAt || 0);
    });

    // Remove oldest PRUNE_PERCENTAGE
    const toRemove = Math.ceil(keys.length * PRUNE_PERCENTAGE);
    const keysToRemove = sorted.slice(0, toRemove);

    const skillsDir = getSkillsCacheDir();
    for (const key of keysToRemove) {
      try {
        const filePath = join(skillsDir, `${key}.json`);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
        delete index.skills[key];
      } catch {
        // Ignore individual file errors
      }
    }

    saveCacheIndex(index);
  } catch {
    // Ignore prune errors
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { count: number; size: number } {
  try {
    const index = loadCacheIndex();
    const count = Object.keys(index.skills).length;

    let size = 0;
    const skillsDir = getSkillsCacheDir();
    if (existsSync(skillsDir)) {
      const files = readdirSync(skillsDir);
      for (const file of files) {
        try {
          const content = readFileSync(join(skillsDir, file), 'utf-8');
          size += content.length;
        } catch {
          // Ignore
        }
      }
    }

    return { count, size };
  } catch {
    return { count: 0, size: 0 };
  }
}
