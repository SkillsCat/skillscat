import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SkillDetail, SkillCardData, ApiResponse, FileNode } from '$lib/types';
import { getCached } from '$lib/server/cache';

export const GET: RequestHandler = async ({ params, platform }) => {
  try {
    const db = platform?.env?.DB;

    if (!db) {
      return json({
        success: false,
        error: 'Database not available'
      } satisfies ApiResponse<never>, { status: 503 });
    }

    const { data, hit } = await getCached(
      `api:skill:${params.slug}`,
      async () => {
        // Get skill by slug
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
            s.updated_at as updatedAt,
            s.readme,
            s.file_structure as fileStructure,
            s.last_commit_at as lastCommitAt,
            s.created_at as createdAt,
            s.indexed_at as indexedAt,
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
        `).bind(params.slug).first<{
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

        // Parse file structure JSON
        let fileStructure: FileNode[] | null = null;
        if (row.fileStructure) {
          try {
            fileStructure = JSON.parse(row.fileStructure);
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
          visibility: 'public',
          sourceType: 'github',
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
              s.updated_at as updatedAt,
              GROUP_CONCAT(sc2.category_slug) as categories,
              a.avatar_url as authorAvatar
            FROM skills s
            INNER JOIN skill_categories sc ON s.id = sc.skill_id
            LEFT JOIN skill_categories sc2 ON s.id = sc2.skill_id
            LEFT JOIN authors a ON s.repo_owner = a.username
            WHERE sc.category_slug IN (${skill.categories.map(() => '?').join(',')})
              AND s.id != ?
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

    return json({
      success: true,
      data
    } satisfies ApiResponse<{ skill: SkillDetail; relatedSkills: SkillCardData[] }>, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
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
