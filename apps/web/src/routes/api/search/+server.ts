import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CATEGORIES } from '$lib/constants';
import type { SkillCardData, ApiResponse } from '$lib/types';

export const GET: RequestHandler = async ({ url, platform }) => {
  try {
    const query = url.searchParams.get('q')?.toLowerCase();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 20);

    if (!query || query.length < 2) {
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
    const kv = platform?.env?.KV;

    // Check cache first
    const cacheKey = `api:search:${query}:${limit}`;
    if (kv) {
      try {
        const cached = await kv.get<{ skills: SkillCardData[]; categories: typeof CATEGORIES; total: number }>(cacheKey, 'json');
        if (cached) {
          return json({
            success: true,
            data: {
              skills: cached.skills,
              categories: cached.categories
            },
            meta: {
              total: cached.total
            }
          } satisfies ApiResponse<{ skills: SkillCardData[]; categories: typeof CATEGORIES }>, {
            headers: {
              'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
              'X-Cache': 'HIT'
            }
          });
        }
      } catch {
        // Cache miss
      }
    }

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
            s.updated_at as updatedAt,
            GROUP_CONCAT(sc.category_slug) as categories,
            a.avatar_url as authorAvatar
          FROM skills s
          LEFT JOIN skill_categories sc ON s.id = sc.skill_id
          LEFT JOIN authors a ON s.repo_owner = a.username
          WHERE s.name LIKE ? OR s.description LIKE ?
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

    // Cache the result
    if (kv && (skills.length > 0 || matchedCategories.length > 0)) {
      try {
        await kv.put(cacheKey, JSON.stringify({ skills, categories: matchedCategories, total }), { expirationTtl: 60 });
      } catch {
        // Ignore cache write errors
      }
    }

    return json({
      success: true,
      data: {
        skills,
        categories: matchedCategories
      },
      meta: {
        total
      }
    } satisfies ApiResponse<{ skills: SkillCardData[]; categories: typeof matchedCategories }>, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
        'X-Cache': 'MISS'
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
