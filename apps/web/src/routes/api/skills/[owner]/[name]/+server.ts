import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SkillDetail, SkillCardData, ApiResponse, FileNode } from '$lib/types';
import { getCached, invalidateCache } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { isSkillOwner, checkSkillAccess } from '$lib/server/permissions';
import { normalizeSkillOwner } from '$lib/skill-path';

/**
 * GET /api/skills/[owner]/[name] - Get skill by owner and name
 *
 * This is the two-segment path version that produces clean URLs like:
 * /api/skills/testuser/my-skill instead of /api/skills/%40testuser%2Fmy-skill
 */
export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const owner = normalizeSkillOwner(params.owner);
  const { name } = params;
  if (!owner || !name) {
    throw error(400, 'Invalid skill identifier');
  }
  const slug = `${owner}/${name}`;

  try {
    const db = platform?.env?.DB;

    if (!db) {
      return json({
        success: false,
        error: 'Database not available'
      } satisfies ApiResponse<never>, { status: 503 });
    }

    const { data, hit } = await getCached(
      `api:skill:${slug}`,
      async () => {
        const row = await db.prepare(`
          SELECT
            s.id,
            s.name,
            s.slug,
            s.description,
            s.repo_owner as repoOwner,
            s.repo_name as repoName,
            s.github_url as githubUrl,
            s.skill_path as skillPath,
            s.stars,
            s.forks,
            s.trending_score as trendingScore,
            COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
            s.readme,
            s.file_structure as fileStructure,
            s.last_commit_at as lastCommitAt,
            s.created_at as createdAt,
            s.indexed_at as indexedAt,
            s.source_type as sourceType,
            s.visibility,
            GROUP_CONCAT(sc.category_slug) as categories,
            a.username as authorUsername,
            a.display_name as authorDisplayName,
            a.avatar_url as authorAvatar,
            a.bio as authorBio,
            a.skills_count as authorSkillsCount,
            a.total_stars as authorTotalStars
          FROM skills s
          LEFT JOIN skill_categories sc ON s.id = sc.skill_id
          LEFT JOIN authors a ON s.repo_owner = a.username
          WHERE s.slug = ?
          GROUP BY s.id
        `).bind(slug).first<{
          id: string;
          name: string;
          slug: string;
          description: string | null;
          repoOwner: string;
          repoName: string;
          githubUrl: string;
          skillPath: string;
          stars: number;
          forks: number;
          trendingScore: number;
          updatedAt: number;
          readme: string | null;
          fileStructure: string | null;
          lastCommitAt: number | null;
          createdAt: number;
          indexedAt: number;
          sourceType: string;
          visibility: string;
          categories: string | null;
          authorUsername: string | null;
          authorDisplayName: string | null;
          authorAvatar: string | null;
          authorBio: string | null;
          authorSkillsCount: number | null;
          authorTotalStars: number | null;
        }>();

        if (!row) {
          return null;
        }

        // Parse file structure JSON (use pre-built fileTree)
        let fileStructure: FileNode[] | null = null;
        if (row.fileStructure) {
          try {
            const parsed = JSON.parse(row.fileStructure);
            if (parsed.fileTree && Array.isArray(parsed.fileTree)) {
              fileStructure = parsed.fileTree;
            }
          } catch {
            // Invalid JSON, leave as null
          }
        }

        const skill: SkillDetail = {
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          repoOwner: row.repoOwner,
          repoName: row.repoName,
          githubUrl: row.githubUrl,
          skillPath: row.skillPath,
          stars: row.stars,
          forks: row.forks,
          trendingScore: row.trendingScore,
          updatedAt: row.updatedAt,
          readme: row.readme,
          fileStructure,
          lastCommitAt: row.lastCommitAt,
          createdAt: row.createdAt,
          indexedAt: row.indexedAt,
          categories: row.categories ? row.categories.split(',') : [],
          authorAvatar: row.authorAvatar || undefined,
          authorUsername: row.authorUsername || undefined,
          authorDisplayName: row.authorDisplayName || undefined,
          authorBio: row.authorBio || undefined,
          authorSkillsCount: row.authorSkillsCount || undefined,
          authorTotalStars: row.authorTotalStars || undefined,
          visibility: (row.visibility as 'public' | 'private' | 'unlisted') || 'public',
          sourceType: (row.sourceType as 'github' | 'upload') || 'github',
        };

        // Get related skills (same category, exclude current)
        let relatedSkills: SkillCardData[] = [];

        if (skill.categories.length > 0) {
          const relatedResult = await db.prepare(`
            SELECT DISTINCT
              s.id,
              s.name,
              s.slug,
              s.description,
              s.repo_owner as repoOwner,
              s.repo_name as repoName,
              s.stars,
              s.forks,
              s.trending_score as trendingScore,
              COALESCE(s.last_commit_at, s.updated_at) as updatedAt,
              GROUP_CONCAT(sc2.category_slug) as categories,
              a.avatar_url as authorAvatar
            FROM skills s
            INNER JOIN skill_categories sc ON s.id = sc.skill_id
            LEFT JOIN skill_categories sc2 ON s.id = sc2.skill_id
            LEFT JOIN authors a ON s.repo_owner = a.username
            WHERE sc.category_slug IN (${skill.categories.map(() => '?').join(',')})
              AND s.id != ?
              AND s.visibility = 'public'
            GROUP BY s.id
            ORDER BY s.trending_score DESC
            LIMIT 6
          `).bind(...skill.categories, row.id).all<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            repoOwner: string;
            repoName: string;
            stars: number;
            forks: number;
            trendingScore: number;
            updatedAt: number;
            categories: string | null;
            authorAvatar: string | null;
          }>();

          relatedSkills = (relatedResult.results || []).map(r => ({
            id: r.id,
            name: r.name,
            slug: r.slug,
            description: r.description,
            repoOwner: r.repoOwner,
            repoName: r.repoName,
            stars: r.stars,
            forks: r.forks,
            trendingScore: r.trendingScore,
            updatedAt: r.updatedAt,
            categories: r.categories ? r.categories.split(',') : [],
            authorAvatar: r.authorAvatar || undefined
          }));
        }

        return { skill, relatedSkills };
      },
      300
    );

    if (!data) {
      return json({
        success: false,
        error: 'Skill not found'
      } satisfies ApiResponse<never>, { status: 404 });
    }

    // Access control for private skills
    if (data.skill.visibility === 'private') {
      const auth = await getAuthContext(request, locals, db);
      if (!auth.userId) {
        return json({
          success: false,
          error: 'Authentication required'
        } satisfies ApiResponse<never>, { status: 401 });
      }
      requireScope(auth, 'read');
      const hasAccess = await checkSkillAccess(data.skill.id, auth.userId, db);
      if (!hasAccess) {
        return json({
          success: false,
          error: 'You do not have permission to access this skill'
        } satisfies ApiResponse<never>, { status: 403 });
      }
    }

    const isPrivate = data.skill.visibility === 'private';

    return json({
      success: true,
      data
    } satisfies ApiResponse<{ skill: SkillDetail; relatedSkills: SkillCardData[] }>, {
      headers: {
        'Cache-Control': isPrivate ? 'private, no-cache' : 'public, max-age=300, stale-while-revalidate=600',
        'X-Cache': hit ? 'HIT' : 'MISS'
      }
    });
  } catch (err) {
    console.error('Error fetching skill:', err);
    return json({
      success: false,
      error: 'Failed to fetch skill'
    } satisfies ApiResponse<never>, { status: 500 });
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
    const parts = skill.slug.split('/');
    if (parts.length >= 2) {
      return [`skills/${parts[0]}/${parts[1]}/SKILL.md`];
    }
    return [`skills/${skill.slug}/SKILL.md`];
  }

  // For GitHub-sourced skills
  const pathPart = skill.skill_path ? `/${skill.skill_path}` : '';
  return [`skills/${skill.repo_owner}/${skill.repo_name}${pathPart}/SKILL.md`];
}

/**
 * DELETE /api/skills/[owner]/[name] - Delete a private skill
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
  const { name } = params;
  if (!owner || !name) {
    throw error(400, 'Invalid skill identifier');
  }
  const slug = `${owner}/${name}`;

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

  // Delete from database (cascades handle related tables like skill_categories, skill_tags, etc.)
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
      `skill:${skill.id}`,
      `related:${skill.id}`,
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
