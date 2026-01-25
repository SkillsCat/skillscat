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

import type { BaseEnv, SkillTier } from './shared/types';

interface ArchiveEnv extends BaseEnv {}

interface SkillToArchive {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  stars: number;
  forks: number;
  star_snapshots: string | null;
  trending_score: number;
  last_commit_at: number | null;
  last_accessed_at: number | null;
  created_at: number;
  indexed_at: number;
}

/**
 * Find skills that should be archived
 */
async function findArchiveCandidates(env: ArchiveEnv): Promise<SkillToArchive[]> {
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60 * 1000;

  const result = await env.DB.prepare(`
    SELECT id, name, slug, description, repo_owner, repo_name, stars, forks,
           star_snapshots, trending_score, last_commit_at, last_accessed_at,
           created_at, indexed_at
    FROM skills
    WHERE visibility = 'public'
      AND tier != 'archived'
      AND stars < 5
      AND (last_accessed_at IS NULL OR last_accessed_at < ?)
      AND (last_commit_at IS NULL OR last_commit_at < ?)
    LIMIT 1000
  `)
    .bind(oneYearAgo, twoYearsAgo)
    .all<SkillToArchive>();

  return result.results;
}

/**
 * Archive a single skill to R2
 */
async function archiveSkill(
  env: ArchiveEnv,
  skill: SkillToArchive
): Promise<boolean> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  try {
    // Get categories
    const categories = await env.DB.prepare(`
      SELECT category_slug FROM skill_categories WHERE skill_id = ?
    `)
      .bind(skill.id)
      .all<{ category_slug: string }>();

    // Get SKILL.md content from R2
    let skillMdContent: string | null = null;
    const skillMdPath = `skills/${skill.repo_owner}/${skill.repo_name}/SKILL.md`;
    const skillMdObject = await env.R2.get(skillMdPath);
    if (skillMdObject) {
      skillMdContent = await skillMdObject.text();
    }

    // Create archive object
    const archiveData = {
      ...skill,
      categories: categories.results.map(c => c.category_slug),
      skillMdContent,
      archivedAt: now.toISOString(),
    };

    // Save to archive location in R2
    const archivePath = `archive/${year}/${month}/${skill.id}.json`;
    await env.R2.put(archivePath, JSON.stringify(archiveData, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });

    // Delete original SKILL.md from R2 (save storage)
    if (skillMdObject) {
      await env.R2.delete(skillMdPath);
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

    return true;
  } catch (error) {
    console.error(`Failed to archive skill ${skill.id}:`, error);
    return false;
  }
}

/**
 * Record archive metrics to KV
 */
async function recordMetrics(
  env: ArchiveEnv,
  stats: { total: number; archived: number; failed: number }
): Promise<void> {
  const now = new Date();
  const monthKey = `metrics:archive:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await env.KV.put(monthKey, JSON.stringify({
    ...stats,
    timestamp: Date.now(),
  }), {
    expirationTtl: 365 * 24 * 60 * 60, // 1 year
  });
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: ArchiveEnv,
    ctx: ExecutionContext
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

    // Archive each skill
    for (const skill of candidates) {
      const success = await archiveSkill(env, skill);
      if (success) {
        archived++;
        console.log(`Archived skill: ${skill.slug}`);
      } else {
        failed++;
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

  async fetch(
    request: Request,
    env: ArchiveEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Metrics endpoint
    if (url.pathname === '/metrics') {
      const now = new Date();
      const monthKey = `metrics:archive:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const metrics = await env.KV.get(monthKey, 'json');
      return new Response(JSON.stringify(metrics || {}), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Restore endpoint (for manual restoration)
    if (url.pathname === '/restore' && request.method === 'POST') {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.WORKER_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }

      const body = await request.json() as { skillId: string };
      const { skillId } = body;

      if (!skillId) {
        return new Response('Missing skillId', { status: 400 });
      }

      // Find archive file
      const archiveList = await env.R2.list({ prefix: 'archive/' });
      let archivePath: string | null = null;

      for (const obj of archiveList.objects) {
        if (obj.key.includes(skillId)) {
          archivePath = obj.key;
          break;
        }
      }

      if (!archivePath) {
        return new Response('Archive not found', { status: 404 });
      }

      // Restore from archive
      const archiveObj = await env.R2.get(archivePath);
      if (!archiveObj) {
        return new Response('Archive file not found', { status: 404 });
      }

      const archiveData = await archiveObj.json() as SkillToArchive & {
        categories: string[];
        skillMdContent: string | null;
      };

      // Restore SKILL.md to R2
      if (archiveData.skillMdContent) {
        const skillMdPath = `skills/${archiveData.repo_owner}/${archiveData.repo_name}/SKILL.md`;
        await env.R2.put(skillMdPath, archiveData.skillMdContent, {
          httpMetadata: { contentType: 'text/markdown' },
        });
      }

      // Update skill tier to cold
      await env.DB.prepare(`
        UPDATE skills SET tier = 'cold', updated_at = ? WHERE id = ?
      `)
        .bind(Date.now(), skillId)
        .run();

      // Restore categories
      for (const categorySlug of archiveData.categories) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO skill_categories (skill_id, category_slug)
          VALUES (?, ?)
        `)
          .bind(skillId, categorySlug)
          .run();
      }

      // Delete archive file
      await env.R2.delete(archivePath);

      return new Response(JSON.stringify({ success: true, skillId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};