import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ApiResponse } from '$lib/types';
import { invalidateCache } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { isSkillOwner } from '$lib/server/auth/permissions';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import {
  buildSkillSlug,
  buildUploadSkillR2Key,
  normalizeSkillName,
  normalizeSkillOwner,
  parseSkillSlug,
} from '$lib/skill-path';

function responseHeaders(opts: { cacheControl: string; cacheStatus: 'HIT' | 'MISS' | 'BYPASS' }): Record<string, string> {
  return {
    'Cache-Control': opts.cacheControl,
    Vary: 'Authorization',
    'X-Cache': opts.cacheStatus,
  };
}

/**
 * GET /api/skills/[owner]/[...name] - Get skill by owner and name
 */
export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const owner = normalizeSkillOwner(params.owner);
  const name = normalizeSkillName(params.name);
  if (!owner || !name) {
    throw error(400, 'Invalid skill identifier');
  }
  const slug = buildSkillSlug(owner, name);

  try {
    const db = platform?.env?.DB;
    const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
    const resolved = await resolveSkillDetail({ db, request, locals, waitUntil }, slug);

    if (!resolved.data) {
      return json({
        success: false,
        error: resolved.error || 'Skill not found'
      } satisfies ApiResponse<never>, {
        status: resolved.status,
        headers: responseHeaders({
          cacheControl: resolved.cacheControl,
          cacheStatus: resolved.cacheStatus,
        })
      });
    }

    return json({
      success: true,
      data: resolved.data
    } satisfies ApiResponse<typeof resolved.data>, {
      status: resolved.status,
      headers: responseHeaders({
        cacheControl: resolved.cacheControl,
        cacheStatus: resolved.cacheStatus,
      })
    });
  } catch (err) {
    console.error('Error fetching skill:', err);
    return json({
      success: false,
      error: 'Failed to fetch skill'
    } satisfies ApiResponse<never>, {
      status: 500,
      headers: responseHeaders({
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
      })
    });
  }
};

interface SkillInfo {
  id: string;
  slug: string;
  owner_id: string | null;
  source_type: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
}

/**
 * Build possible R2 paths for a skill's SKILL.md file.
 */
function buildR2Paths(skill: SkillInfo): string[] {
  if (skill.source_type === 'upload') {
    const canonical = buildUploadSkillR2Key(skill.slug, 'SKILL.md');
    const parts = parseSkillSlug(skill.slug);
    const paths = new Set<string>();

    if (canonical) {
      paths.add(canonical);
    }

    if (parts) {
      // Legacy fallback for previously stored upload paths.
      paths.add(`skills/${parts.owner}/${parts.name.split('/')[0]}/SKILL.md`);
    }

    return [...paths];
  }

  // For GitHub-sourced skills
  const pathPart = skill.skill_path ? `/${skill.skill_path}` : '';
  return [`skills/${skill.repo_owner}/${skill.repo_name}${pathPart}/SKILL.md`];
}

/**
 * DELETE /api/skills/[owner]/[...name] - Delete a private skill
 *
 * Only the owner can delete a skill, and only uploaded (private) skills can be deleted.
 * GitHub-sourced skills cannot be deleted through this endpoint.
 */
export const DELETE: RequestHandler = async ({ locals, platform, request, params }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  if (!db || !r2) {
    throw error(500, 'Storage not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const owner = normalizeSkillOwner(params.owner);
  const name = normalizeSkillName(params.name);
  if (!owner || !name) {
    throw error(400, 'Invalid skill identifier');
  }
  const slug = buildSkillSlug(owner, name);

  // Fetch skill by slug and verify ownership
  const skill = await db.prepare(`
    SELECT id, slug, owner_id, source_type, repo_owner, repo_name, skill_path
    FROM skills WHERE slug = ?
  `)
    .bind(slug)
    .first<SkillInfo>();

  if (!skill) {
    throw error(404, 'Skill not found');
  }

  // Only owner can delete
  const isOwner = await isSkillOwner(skill.id, auth.userId, db);
  if (!isOwner) {
    throw error(403, 'Only the owner can delete this skill');
  }

  // Only allow deletion of uploaded (private) skills
  if (skill.source_type !== 'upload') {
    throw error(400, 'Cannot delete GitHub-sourced skills. Remove the SKILL.md from your repository instead.');
  }

  const categoryResult = await db
    .prepare('SELECT category_slug FROM skill_categories WHERE skill_id = ?')
    .bind(skill.id)
    .all<{ category_slug: string }>();
  const categorySlugs = (categoryResult.results || []).map((row) => row.category_slug);

  // Delete from database (cascades handle dependent tables like skill_categories, skill_tags, etc.)
  await db.prepare('DELETE FROM skills WHERE id = ?').bind(skill.id).run();

  // Delete R2 files
  try {
    const r2Paths = buildR2Paths(skill);
    for (const r2Path of r2Paths) {
      await r2.delete(r2Path);
    }
  } catch (r2Error) {
    // Log but don't fail - the DB record is already deleted
    console.error(`Failed to delete R2 file for skill ${skill.id}:`, r2Error);
  }

  try {
    const cacheKeys = new Set<string>([
      `api:skill:${skill.slug}`,
      `api:skill-files:${skill.slug}`,
      `skill:${skill.id}`,
      `recommend:${skill.id}`,
      'page:home:v1',
      'page:trending:v1:1',
      'page:recent:v1:1',
      'page:top:v1:1',
      'page:categories:v1',
    ]);

    for (const categorySlug of categorySlugs) {
      cacheKeys.add(`page:category:v1:${categorySlug}:1`);
    }

    await Promise.all(Array.from(cacheKeys, (cacheKey) => invalidateCache(cacheKey)));
  } catch (cacheError) {
    // Log but don't fail
    console.error(`Failed to invalidate cache for skill ${skill.id}:`, cacheError);
  }

  return json({
    success: true,
    message: 'Skill deleted successfully',
  });
};
