import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET /api/orgs/[slug]/members - List organization members
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

  // Get org ID
  const org = await db.prepare(`
    SELECT id FROM organizations WHERE slug = ?
  `)
    .bind(slug)
    .first<{ id: string }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  const results = await db.prepare(`
    SELECT om.user_id, om.role, om.joined_at, u.name, u.email, u.image
    FROM org_members om
    LEFT JOIN user u ON om.user_id = u.id
    WHERE om.org_id = ?
    ORDER BY om.joined_at
  `)
    .bind(org.id)
    .all<{
      user_id: string;
      role: string;
      joined_at: number;
      name: string | null;
      email: string | null;
      image: string | null;
    }>();

  return json({
    success: true,
    members: results.results.map(m => ({
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      name: m.name,
      email: m.email,
      image: m.image,
    })),
  });
};

/**
 * POST /api/orgs/[slug]/members - Invite a member
 */
export const POST: RequestHandler = async ({ locals, platform, params, request }) => {
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
    SELECT om.role, o.id as org_id FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ role: string; org_id: string }>();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw error(403, 'Only organization owners and admins can invite members');
  }

  const body = await request.json() as {
    userId?: string;
    email?: string;
    role?: 'admin' | 'member';
  };

  const { userId, email, role = 'member' } = body;

  if (!userId && !email) {
    throw error(400, 'Either userId or email is required');
  }

  // Find user by ID or email
  let targetUserId = userId;
  if (!targetUserId && email) {
    const user = await db.prepare(`
      SELECT id FROM user WHERE email = ?
    `)
      .bind(email)
      .first<{ id: string }>();

    if (!user) {
      throw error(404, 'User not found with that email');
    }
    targetUserId = user.id;
  }

  // Check if already a member
  const existing = await db.prepare(`
    SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?
  `)
    .bind(membership.org_id, targetUserId)
    .first();

  if (existing) {
    throw error(409, 'User is already a member of this organization');
  }

  // Add member
  await db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, invited_by, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `)
    .bind(membership.org_id, targetUserId, role, session.user.id, Date.now())
    .run();

  return json({
    success: true,
    message: 'Member invited successfully',
  });
};

/**
 * DELETE /api/orgs/[slug]/members - Remove a member
 */
export const DELETE: RequestHandler = async ({ locals, platform, params, request }) => {
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

  const body = await request.json() as { userId: string };
  const { userId } = body;

  if (!userId) {
    throw error(400, 'userId is required');
  }

  // Get org and check permissions
  const org = await db.prepare(`
    SELECT id, owner_id FROM organizations WHERE slug = ?
  `)
    .bind(slug)
    .first<{ id: string; owner_id: string }>();

  if (!org) {
    throw error(404, 'Organization not found');
  }

  // Can't remove the owner
  if (userId === org.owner_id) {
    throw error(400, 'Cannot remove the organization owner');
  }

  // Check if requester is owner or admin
  const requesterMembership = await db.prepare(`
    SELECT role FROM org_members WHERE org_id = ? AND user_id = ?
  `)
    .bind(org.id, session.user.id)
    .first<{ role: string }>();

  // Users can remove themselves, or owners/admins can remove others
  const isSelf = userId === session.user.id;
  const isAdmin = requesterMembership && ['owner', 'admin'].includes(requesterMembership.role);

  if (!isSelf && !isAdmin) {
    throw error(403, 'Only organization owners and admins can remove members');
  }

  const result = await db.prepare(`
    DELETE FROM org_members WHERE org_id = ? AND user_id = ?
  `)
    .bind(org.id, userId)
    .run();

  if (result.meta.changes === 0) {
    throw error(404, 'Member not found');
  }

  return json({
    success: true,
    message: 'Member removed successfully',
  });
};
