import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ApiResponse } from '$lib/types';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { isSkillOwner } from '$lib/server/auth/permissions';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import { normalizeSkillSlug } from '$lib/skill-path';
import { deleteSkillArtifactsAndInvalidateCaches } from '$lib/server/skill/delete';

function responseHeaders(opts: { cacheControl: string; cacheStatus: 'HIT' | 'MISS' | 'BYPASS' }): Record<string, string> {
  return {
    'Cache-Control': opts.cacheControl,
    Vary: 'Authorization',
    'X-Cache': opts.cacheStatus,
  };
}

export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const slug = normalizeSkillSlug(params.slug || '');
  if (!slug) {
    throw error(400, 'Invalid skill slug');
  }

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
 * DELETE /api/skills/[slug] - Delete a private skill
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

  const slug = normalizeSkillSlug(params.slug || '');
  if (!slug) {
    throw error(400, 'Invalid skill slug');
  }

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

  await deleteSkillArtifactsAndInvalidateCaches({
    db,
    r2,
    skill: {
      id: skill.id,
      slug: skill.slug,
      sourceType: skill.source_type,
      repoOwner: skill.repo_owner,
      repoName: skill.repo_name,
      skillPath: skill.skill_path,
    },
  });

  return json({
    success: true,
    message: 'Skill deleted successfully',
  });
};
