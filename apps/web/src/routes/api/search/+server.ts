import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES } from '$lib/constants';
import type { SkillCardData, ApiResponse } from '$lib/types';
import { getCached } from '$lib/server/cache';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 120;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

function parseLimit(rawLimit: string | null): number {
  const parsed = Number.parseInt(rawLimit || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

export const GET: RequestHandler = async ({ url, platform }) => {
  try {
    const query = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
    const limit = parseLimit(url.searchParams.get('limit'));

    if (!query || query.length < MIN_QUERY_LENGTH) {
      return json({
        success: true,
        data: {
          skills: [],
          categories: []
        },
        meta: { total: 0 }
      });
    }

    const db = platform?.env?.DB;

    const { data, hit } = await getCached(
      `api:search:${query}:${limit}`,
      async () => {
        // Search categories (from constants)
        const matchedCategories = CATEGORIES.filter(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            c.description.toLowerCase().includes(query) ||
            c.keywords.some((k) => k.includes(query))
        ).slice(0, 5);

        // Search skills from D1 database
        let skills: SkillCardData[] = [];

        if (db) {
          try {
            const result = await db.prepare(`
              SELECT
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
                GROUP_CONCAT(sc.category_slug) as categories,
                a.avatar_url as authorAvatar
              FROM skills s
              LEFT JOIN skill_categories sc ON s.id = sc.skill_id
              LEFT JOIN authors a ON s.repo_owner = a.username
              WHERE (s.name LIKE ? OR s.description LIKE ?)
                AND s.visibility = 'public'
              GROUP BY s.id
              ORDER BY s.trending_score DESC
              LIMIT ?
            `).bind(`%${query}%`, `%${query}%`, limit).all<{
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

            skills = (result.results || []).map(row => ({
              id: row.id,
              name: row.name,
              slug: row.slug,
              description: row.description,
              repoOwner: row.repoOwner,
              repoName: row.repoName,
              stars: row.stars,
              forks: row.forks,
              trendingScore: row.trendingScore,
              updatedAt: row.updatedAt,
              categories: row.categories ? row.categories.split(',') : [],
              authorAvatar: row.authorAvatar || undefined
            }));
          } catch {
            // Database query failed, return empty results
          }
        }

        const total = skills.length + matchedCategories.length;
        return { skills, categories: matchedCategories, total };
      },
      60
    );

    return json({
      success: true,
      data: {
        skills: data.skills,
        categories: data.categories
      },
      meta: {
        total: data.total
      }
    } satisfies ApiResponse<{ skills: SkillCardData[]; categories: typeof data.categories }>, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
        'X-Cache': hit ? 'HIT' : 'MISS'
      }
    });
  } catch (error) {
    console.error('Error searching:', error);
    return json({
      success: false,
      error: 'Search failed'
    } satisfies ApiResponse<never>, { status: 500 });
  }
};
