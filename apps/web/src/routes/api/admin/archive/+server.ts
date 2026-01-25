/**
 * Admin API: Archive Restore
 *
 * POST /api/admin/archive
 * Restore an archived skill
 *
 * Requires WORKER_SECRET authentication
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

interface SkillArchiveData {
  id: string;
  repo_owner: string;
  repo_name: string;
  categories: string[];
  skillMdContent: string | null;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  // Verify authentication
  const authHeader = request.headers.get('Authorization');
  const workerSecret = env?.WORKER_SECRET || platform?.env?.WORKER_SECRET;

  if (!workerSecret || authHeader !== `Bearer ${workerSecret}`) {
    throw error(401, 'Unauthorized');
  }

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  if (!db || !r2) {
    throw error(500, 'Database or storage not available');
  }

  const body = await request.json() as { skillId: string };
  const { skillId } = body;

  if (!skillId) {
    throw error(400, 'Missing skillId');
  }

  try {
    // Find archive file
    const archiveList = await r2.list({ prefix: 'archive/' });
    let archivePath: string | null = null;

    for (const obj of archiveList.objects) {
      if (obj.key.includes(skillId)) {
        archivePath = obj.key;
        break;
      }
    }

    if (!archivePath) {
      throw error(404, 'Archive not found');
    }

    // Restore from archive
    const archiveObj = await r2.get(archivePath);
    if (!archiveObj) {
      throw error(404, 'Archive file not found');
    }

    const archiveData = await archiveObj.json() as SkillArchiveData;

    // Restore SKILL.md to R2
    if (archiveData.skillMdContent) {
      const skillMdPath = `skills/${archiveData.repo_owner}/${archiveData.repo_name}/SKILL.md`;
      await r2.put(skillMdPath, archiveData.skillMdContent, {
        httpMetadata: { contentType: 'text/markdown' },
      });
    }

    // Update skill tier to cold
    await db.prepare(`
      UPDATE skills SET tier = 'cold', updated_at = ? WHERE id = ?
    `)
      .bind(Date.now(), skillId)
      .run();

    // Restore categories
    for (const categorySlug of archiveData.categories) {
      await db.prepare(`
        INSERT OR IGNORE INTO skill_categories (skill_id, category_slug)
        VALUES (?, ?)
      `)
        .bind(skillId, categorySlug)
        .run();
    }

    // Delete archive file
    await r2.delete(archivePath);

    return json({ success: true, skillId });
  } catch (err) {
    console.error('Archive restore error:', err);
    if (err instanceof Error && 'status' in err) {
      throw err;
    }
    throw error(500, 'Failed to restore archive');
  }
};
