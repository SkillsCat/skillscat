/**
 * Archive Worker
 *
 * Runs monthly to archive cold/inactive skills:
 * - 1 year no access
 * - stars < 5
 * - 2 years no commit
 *
 * Archives to R2 and updates tier to 'archived'
 */

import type { BaseEnv } from './shared/types';
import { buildGithubSkillR2Keys, buildUploadSkillR2Key } from '../src/lib/skill-path';
import { invalidateCategoryCaches } from '../src/lib/server/cache/categories';
import { syncCategoryPublicStats } from '../src/lib/server/db/business/stats';

interface ArchiveEnv extends BaseEnv {}

interface SkillToArchive {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  source_type: string;
  repo_owner: string;
  repo_name: string;
  skill_path: string | null;
  stars: number;
  forks: number;
  star_snapshots: string | null;
  trending_score: number;
  last_commit_at: number | null;
  last_accessed_at: number | null;
  created_at: number;
  indexed_at: number;
}

async function loadArchiveCategorySlugsBySkillId(
  env: Pick<ArchiveEnv, 'DB'>,
  skillIds: string[]
): Promise<Map<string, string[]>> {
  if (skillIds.length === 0) {
    return new Map();
  }

  const placeholders = skillIds.map(() => '?').join(',');
  const result = await env.DB.prepare(`
    SELECT skill_id, category_slug
    FROM skill_categories
    WHERE skill_id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all<{ skill_id: string; category_slug: string }>();

  const categorySlugsBySkillId = new Map<string, string[]>();
  for (const row of result.results || []) {
    const existing = categorySlugsBySkillId.get(row.skill_id);
    if (existing) {
      existing.push(row.category_slug);
    } else {
      categorySlugsBySkillId.set(row.skill_id, [row.category_slug]);
    }
  }

  return categorySlugsBySkillId;
}

/**
 * Find skills that should be archived
 */
async function findArchiveCandidates(env: ArchiveEnv): Promise<SkillToArchive[]> {
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60 * 1000;
  const perTierLimit = 250;

  const result = await env.DB.prepare(`
    WITH candidates AS (
      SELECT * FROM (
        SELECT id, name, slug, description, source_type, repo_owner, repo_name, skill_path, stars, forks,
               star_snapshots, trending_score, last_commit_at, last_accessed_at,
               created_at, indexed_at
        FROM skills INDEXED BY skills_public_archive_candidates_idx
        WHERE visibility = 'public'
          AND tier = 'hot'
          AND stars < 5
          AND CASE WHEN last_accessed_at IS NULL THEN 0 ELSE last_accessed_at END < ?
          AND CASE WHEN last_commit_at IS NULL THEN 0 ELSE last_commit_at END < ?
        LIMIT ?
      )
      UNION ALL
      SELECT * FROM (
        SELECT id, name, slug, description, source_type, repo_owner, repo_name, skill_path, stars, forks,
               star_snapshots, trending_score, last_commit_at, last_accessed_at,
               created_at, indexed_at
        FROM skills INDEXED BY skills_public_archive_candidates_idx
        WHERE visibility = 'public'
          AND tier = 'warm'
          AND stars < 5
          AND CASE WHEN last_accessed_at IS NULL THEN 0 ELSE last_accessed_at END < ?
          AND CASE WHEN last_commit_at IS NULL THEN 0 ELSE last_commit_at END < ?
        LIMIT ?
      )
      UNION ALL
      SELECT * FROM (
        SELECT id, name, slug, description, source_type, repo_owner, repo_name, skill_path, stars, forks,
               star_snapshots, trending_score, last_commit_at, last_accessed_at,
               created_at, indexed_at
        FROM skills INDEXED BY skills_public_archive_candidates_idx
        WHERE visibility = 'public'
          AND tier = 'cool'
          AND stars < 5
          AND CASE WHEN last_accessed_at IS NULL THEN 0 ELSE last_accessed_at END < ?
          AND CASE WHEN last_commit_at IS NULL THEN 0 ELSE last_commit_at END < ?
        LIMIT ?
      )
      UNION ALL
      SELECT * FROM (
        SELECT id, name, slug, description, source_type, repo_owner, repo_name, skill_path, stars, forks,
               star_snapshots, trending_score, last_commit_at, last_accessed_at,
               created_at, indexed_at
        FROM skills INDEXED BY skills_public_archive_candidates_idx
        WHERE visibility = 'public'
          AND tier = 'cold'
          AND stars < 5
          AND CASE WHEN last_accessed_at IS NULL THEN 0 ELSE last_accessed_at END < ?
          AND CASE WHEN last_commit_at IS NULL THEN 0 ELSE last_commit_at END < ?
        LIMIT ?
      )
    )
    SELECT *
    FROM candidates
    LIMIT 1000
  `)
    .bind(
      oneYearAgo, twoYearsAgo, perTierLimit,
      oneYearAgo, twoYearsAgo, perTierLimit,
      oneYearAgo, twoYearsAgo, perTierLimit,
      oneYearAgo, twoYearsAgo, perTierLimit,
    )
    .all<SkillToArchive>();

  return result.results;
}

/**
 * Archive a single skill to R2
 */
async function archiveSkill(
  env: ArchiveEnv,
  skill: SkillToArchive,
  preloadedCategorySlugs: string[] | undefined = undefined
): Promise<{ archived: boolean; categorySlugs: string[] }> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  try {
    const categorySlugs = preloadedCategorySlugs ?? [];

    // Get SKILL.md content from R2
    let skillMdContent: string | null = null;
    let cachedSkillMdKey: string | null = null;
    const skillMdCandidateKeys = skill.source_type === 'upload'
      ? [buildUploadSkillR2Key(skill.slug, 'SKILL.md')].filter(Boolean)
      : buildGithubSkillR2Keys(skill.repo_owner, skill.repo_name, skill.skill_path, 'SKILL.md');

    for (const skillMdKey of skillMdCandidateKeys) {
      const skillMdObject = await env.R2.get(skillMdKey);
      if (!skillMdObject) continue;
      skillMdContent = await skillMdObject.text();
      cachedSkillMdKey = skillMdKey;
      break;
    }

    // Create archive object
    const archiveData = {
      ...skill,
      categories: categorySlugs,
      skillMdContent,
      archivedAt: now.toISOString(),
    };

    // Save to archive location in R2
    const archivePath = `archive/${year}/${month}/${skill.id}.json`;
    await env.R2.put(archivePath, JSON.stringify(archiveData, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });

    // Delete original SKILL.md from R2 (save storage)
    if (cachedSkillMdKey) {
      await env.R2.delete(cachedSkillMdKey);
    }

    // Update skill tier to archived
    await env.DB.prepare(`
      UPDATE skills SET tier = 'archived', updated_at = ? WHERE id = ?
    `)
      .bind(Date.now(), skill.id)
      .run();

    // Delete skill_categories entries (save D1 storage)
    await env.DB.prepare(`
      DELETE FROM skill_categories WHERE skill_id = ?
    `)
      .bind(skill.id)
      .run();

    return {
      archived: true,
      categorySlugs,
    };
  } catch (error) {
    console.error(`Failed to archive skill ${skill.id}:`, error);
    return {
      archived: false,
      categorySlugs: [],
    };
  }
}

function recordMetrics(
  env: ArchiveEnv,
  stats: { total: number; archived: number; failed: number }
): void {
  if (!env.WORKER_ANALYTICS) {
    return;
  }

  try {
    env.WORKER_ANALYTICS.writeDataPoint({
      blobs: ['scheduled'],
      doubles: [stats.total, stats.archived, stats.failed],
      indexes: ['archive-run'],
    });
  } catch (error) {
    console.error('Failed to write archive analytics datapoint:', error);
  }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: ArchiveEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Archive Worker triggered at:', new Date().toISOString());

    // Find archive candidates
    const candidates = await findArchiveCandidates(env);
    console.log(`Found ${candidates.length} archive candidates`);

    if (candidates.length === 0) {
      console.log('No skills to archive');
      return;
    }

    let archived = 0;
    let failed = 0;
    const affectedCategorySlugs = new Set<string>();
    const categorySlugsBySkillId = await loadArchiveCategorySlugsBySkillId(
      env,
      candidates.map((skill) => skill.id)
    );

    // Archive each skill
    for (const skill of candidates) {
      const result = await archiveSkill(env, skill, categorySlugsBySkillId.get(skill.id) || []);
      if (result.archived) {
        archived++;
        for (const categorySlug of result.categorySlugs) {
          if (categorySlug) {
            affectedCategorySlugs.add(categorySlug);
          }
        }
        console.log(`Archived skill: ${skill.slug}`);
      } else {
        failed++;
      }
    }

    if (affectedCategorySlugs.size > 0) {
      try {
        await syncCategoryPublicStats(env.DB, affectedCategorySlugs);
      } catch (error) {
        console.error('Failed to sync category public stats after archive run:', error);
      }

      try {
        await invalidateCategoryCaches(affectedCategorySlugs);
      } catch (error) {
        console.error('Failed to invalidate category caches after archive run:', error);
      }
    }

    console.log(`Archive complete: ${archived} archived, ${failed} failed`);

    // Record metrics
    await recordMetrics(env, {
      total: candidates.length,
      archived,
      failed,
    });

    console.log('Archive Worker completed');
  },
};
