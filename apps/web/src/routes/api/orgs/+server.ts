import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { githubRequest } from '$lib/server/github-request';

/**
 * Check if a name exists on GitHub (as user or organization)
 */
async function checkGitHubNameExists(name: string, githubToken: string): Promise<boolean> {
  try {
    // Check if it's a user or org on GitHub
    const response = await githubRequest(`https://api.github.com/users/${name}`, {
      token: githubToken,
      userAgent: 'SkillsCat/1.0',
    });
    // 200 means the name exists, 404 means it doesn't
    return response.status === 200;
  } catch {
    // On error, allow creation (fail open)
    return false;
  }
}

/**
 * POST /api/orgs - Create a new organization
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const body = await request.json() as {
    name: string;
    displayName?: string;
    description?: string;
  };

  const { name, displayName, description } = body;

  if (!name || typeof name !== 'string') {
    throw error(400, 'Organization name is required');
  }

  // Validate name format (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || name.length < 2 || name.length > 39) {
    throw error(400, 'Organization name must be 2-39 characters and contain only letters, numbers, hyphens, and underscores');
  }

  // Generate slug from name
  const slug = name.toLowerCase();

  // Check if slug already exists
  const existing = await db.prepare(`
    SELECT id FROM organizations WHERE slug = ?
  `)
    .bind(slug)
    .first();

  if (existing) {
    throw error(409, 'An organization with this name already exists');
  }

  // Check if name exists on GitHub
  const githubToken = platform?.env?.GITHUB_TOKEN;
  if (githubToken) {
    const existsOnGitHub = await checkGitHubNameExists(slug, githubToken);
    if (existsOnGitHub) {
      throw error(409, 'This name is already taken on GitHub');
    }
  }

  const orgId = crypto.randomUUID();
  const now = Date.now();

  // Create organization
  await db.prepare(`
    INSERT INTO organizations (id, name, slug, display_name, description, owner_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(orgId, name, slug, displayName || name, description || null, session.user.id, now, now)
    .run();

  // Add creator as owner member
  await db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, joined_at)
    VALUES (?, ?, 'owner', ?)
  `)
    .bind(orgId, session.user.id, now)
    .run();

  return json({
    success: true,
    orgId,
    slug,
    message: 'Organization created successfully',
  });
};

/**
 * GET /api/orgs - List user's organizations
 */
export const GET: RequestHandler = async ({ locals, platform }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const results = await db.prepare(`
    SELECT o.id, o.name, o.slug, o.display_name, o.description, o.avatar_url,
           o.verified_at, om.role, o.created_at
    FROM organizations o
    INNER JOIN org_members om ON o.id = om.org_id
    WHERE om.user_id = ?
    ORDER BY o.name
  `)
    .bind(session.user.id)
    .all<{
      id: string;
      name: string;
      slug: string;
      display_name: string | null;
      description: string | null;
      avatar_url: string | null;
      verified_at: number | null;
      role: string;
      created_at: number;
    }>();

  return json({
    success: true,
    organizations: results.results.map(org => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      displayName: org.display_name,
      description: org.description,
      avatarUrl: org.avatar_url,
      verified: org.verified_at !== null,
      role: org.role,
      createdAt: org.created_at,
    })),
  });
};
