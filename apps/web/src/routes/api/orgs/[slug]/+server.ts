import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET /api/orgs/[slug] - Get organization details
 */
export const GET: RequestHandler = async ({ locals, platform, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  const org = await db.prepare(`
    SELECT id, name, slug, display_name, description, avatar_url, github_org_id, verified_at, owner_id, created_at
    FROM organizations
    WHERE slug = ?
  `)
    .bind(slug)
    .first<{
      id: string;
      name: string;
      slug: string;
      display_name: string | null;
      description: string | null;
      avatar_url: string | null;
      github_org_id: number | null;
      verified_at: number | null;
      owner_id: string;
      created_at: number;
    }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  // Get member count
  const memberCount = await db.prepare(`
    SELECT COUNT(*) as count FROM org_members WHERE org_id = ?
  `)
    .bind(org.id)
    .first<{ count: number }>();

  // Check if current user is a member
  const session = await locals.auth?.();
  let userRole: string | null = null;

  if (session?.user) {
    const membership = await db.prepare(`
      SELECT role FROM org_members WHERE org_id = ? AND user_id = ?
    `)
      .bind(org.id, session.user.id)
      .first<{ role: string }>();

    userRole = membership?.role || null;
  }

  // Non-members should only see public skill counts
  const skillCountQuery = userRole
    ? `SELECT COUNT(*) as count FROM skills WHERE org_id = ?`
    : `SELECT COUNT(*) as count FROM skills WHERE org_id = ? AND visibility = 'public'`;
  const skillCount = await db.prepare(skillCountQuery)
    .bind(org.id)
    .first<{ count: number }>();

  return json({
    success: true,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      displayName: org.display_name,
      description: org.description,
      avatarUrl: org.avatar_url,
      githubConnected: org.github_org_id !== null,
      verified: org.verified_at !== null,
      createdAt: org.created_at,
      memberCount: memberCount?.count || 0,
      skillCount: skillCount?.count || 0,
      userRole,
    },
  });
};

/**
 * PUT /api/orgs/[slug] - Update organization
 */
export const PUT: RequestHandler = async ({ locals, platform, params, request }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Check if user is owner or admin
  const membership = await db.prepare(`
    SELECT om.role FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string }>();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw error(403, 'Only organization owners and admins can update the organization');
  }

  const body = await request.json() as {
    displayName?: string;
    description?: string;
    avatarUrl?: string;
  };

  const { displayName, description, avatarUrl } = body;

  await db.prepare(`
    UPDATE organizations
    SET display_name = COALESCE(?, display_name),
        description = COALESCE(?, description),
        avatar_url = COALESCE(?, avatar_url),
        updated_at = ?
    WHERE slug = ?
  `)
    .bind(displayName, description, avatarUrl, Date.now(), slug)
    .run();

  return json({
    success: true,
    message: 'Organization updated successfully',
  });
};

/**
 * DELETE /api/orgs/[slug] - Delete organization
 */
export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { slug } = params;
  if (!slug) {
    throw error(400, 'Organization slug is required');
  }

  // Only owner can delete
  const org = await db.prepare(`
    SELECT id, owner_id FROM organizations WHERE slug = ?
  `)
    .bind(slug)
    .first<{ id: string; owner_id: string }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  if (org.owner_id !== session.user.id) {
    throw error(403, 'Only the organization owner can delete it');
  }

  // Check if org has skills
  const skillCount = await db.prepare(`
    SELECT COUNT(*) as count FROM skills WHERE org_id = ?
  `)
    .bind(org.id)
    .first<{ count: number }>();

  if (skillCount && skillCount.count > 0) {
    throw error(400, 'Cannot delete organization with existing skills. Transfer or delete skills first.');
  }

  // Delete org members first (cascade should handle this, but be explicit)
  await db.prepare(`DELETE FROM org_members WHERE org_id = ?`).bind(org.id).run();

  // Delete organization
  await db.prepare(`DELETE FROM organizations WHERE id = ?`).bind(org.id).run();

  return json({
    success: true,
    message: 'Organization deleted successfully',
  });
};
