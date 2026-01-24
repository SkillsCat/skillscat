/**
 * Anti-Abuse Module
 *
 * Handles content hashing and duplicate detection to prevent
 * low-quality forks from polluting the registry
 */

import type { D1Database } from '@cloudflare/workers-types';

/**
 * Normalize content for comparison
 * - Remove extra whitespace
 * - Normalize line endings
 * - Remove comments (optional)
 */
function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')       // Collapse multiple blank lines
    .replace(/[ \t]+$/gm, '')         // Remove trailing whitespace
    .replace(/^[ \t]+/gm, '')         // Remove leading whitespace
    .trim();
}

/**
 * Compute SHA-256 hash of content
 */
async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute both full and normalized content hashes
 */
export async function computeContentHashes(content: string): Promise<{
  fullHash: string;
  normalizedHash: string;
}> {
  const fullHash = await computeHash(content);
  const normalizedHash = await computeHash(normalizeContent(content));
  return { fullHash, normalizedHash };
}

/**
 * Check if content is a duplicate of a high-star skill
 */
export async function checkForDuplicate(
  contentHash: string,
  db: D1Database,
  minStars: number = 1000
): Promise<{
  isDuplicate: boolean;
  originalSkillId?: string;
  originalSlug?: string;
  originalStars?: number;
}> {
  // Check for exact match in content_hashes table
  const match = await db.prepare(`
    SELECT ch.skill_id, s.slug, s.stars
    FROM content_hashes ch
    INNER JOIN skills s ON ch.skill_id = s.id
    WHERE ch.hash_value = ?
      AND s.stars >= ?
      AND s.visibility = 'public'
    ORDER BY s.stars DESC
    LIMIT 1
  `)
    .bind(contentHash, minStars)
    .first<{ skill_id: string; slug: string; stars: number }>();

  if (match) {
    return {
      isDuplicate: true,
      originalSkillId: match.skill_id,
      originalSlug: match.slug,
      originalStars: match.stars,
    };
  }

  return { isDuplicate: false };
}

/**
 * Store content hashes for a skill
 */
export async function storeContentHashes(
  skillId: string,
  fullHash: string,
  normalizedHash: string,
  db: D1Database
): Promise<void> {
  const now = Date.now();

  // Store full hash
  await db.prepare(`
    INSERT INTO content_hashes (id, skill_id, hash_type, hash_value, created_at)
    VALUES (?, ?, 'full', ?, ?)
    ON CONFLICT(skill_id, hash_type) DO UPDATE SET
      hash_value = excluded.hash_value
  `)
    .bind(crypto.randomUUID(), skillId, fullHash, now)
    .run();

  // Store normalized hash
  await db.prepare(`
    INSERT INTO content_hashes (id, skill_id, hash_type, hash_value, created_at)
    VALUES (?, ?, 'normalized', ?, ?)
    ON CONFLICT(skill_id, hash_type) DO UPDATE SET
      hash_value = excluded.hash_value
  `)
    .bind(crypto.randomUUID(), skillId, normalizedHash, now)
    .run();
}

/**
 * Check if a new skill should be rejected based on anti-abuse rules
 */
export async function shouldRejectSkill(
  content: string,
  stars: number,
  db: D1Database
): Promise<{
  reject: boolean;
  reason?: string;
  originalSlug?: string;
}> {
  // Only apply anti-abuse to low-star repos
  if (stars >= 100) {
    return { reject: false };
  }

  const { normalizedHash } = await computeContentHashes(content);

  // Check for duplicate of high-star skill
  const duplicate = await checkForDuplicate(normalizedHash, db, 1000);

  if (duplicate.isDuplicate) {
    return {
      reject: true,
      reason: `Content appears to be a copy of ${duplicate.originalSlug} (${duplicate.originalStars} stars)`,
      originalSlug: duplicate.originalSlug,
    };
  }

  return { reject: false };
}
