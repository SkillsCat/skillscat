import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET /api/users/[username] - Get user profile and public skills
 */
export const GET: RequestHandler = async ({ params, platform }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { username } = params;
  if (!username) {
    throw error(400, 'Username is required');
  }

  // Find user by name (username)
  const user = await db.prepare(`
    SELECT u.id, u.name, u.email, u.image, u.created_at as joinedAt,
           a.provider_account_id as githubId
    FROM user u
    LEFT JOIN account a ON u.id = a.user_id AND a.provider_id = 'github'
    WHERE u.name = ?
  `)
    .bind(username)
    .first<{
      id: string;
      name: string;
      email: string | null;
      image: string | null;
      joinedAt: number;
      githubId: string | null;
    }>();

  if (!user) {
    throw error(404, 'User not found');
  }

  // Get user's public skills
  const skillsResult = await db.prepare(`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.stars,
      s.updated_at as updatedAt,
      GROUP_CONCAT(sc.category_slug) as categories
    FROM skills s
    LEFT JOIN skill_categories sc ON s.id = sc.skill_id
    WHERE s.owner_id = ? AND s.visibility = 'public'
    GROUP BY s.id
    ORDER BY s.stars DESC, s.updated_at DESC
  `)
    .bind(user.id)
    .all<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      stars: number;
      updatedAt: number;
      categories: string | null;
    }>();

  // Calculate stats
  const skills = skillsResult.results || [];
  const totalStars = skills.reduce((sum, s) => sum + (s.stars || 0), 0);

  // Get GitHub username if available
  let githubUsername: string | null = null;
  if (user.githubId) {
    // The name field usually contains the GitHub username for GitHub OAuth users
    githubUsername = user.name;
  }

  return json({
    user: {
      id: user.id,
      name: user.name,
      image: user.image,
      bio: null, // Could add bio field to user table later
      githubUsername,
      skillCount: skills.length,
      totalStars,
      joinedAt: user.joinedAt,
    },
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description || '',
      stars: s.stars || 0,
      categories: s.categories ? s.categories.split(',') : [],
      updatedAt: s.updatedAt,
    })),
  });
};
