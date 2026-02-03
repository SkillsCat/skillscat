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
 * POST /api/orgs/[slug]/members - Invite a member by GitHub username
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

  // Check if user is owner or admin and get org info
  const orgData = await db.prepare(`
    SELECT o.id as org_id, o.name as org_name, o.slug as org_slug, o.display_name, om.role
    FROM org_members om
    INNER JOIN organizations o ON om.org_id = o.id
    WHERE o.slug = ? AND om.user_id = ?
  `)
    .bind(slug, session.user.id)
    .first<{ org_id: string; org_name: string; org_slug: string; display_name: string | null; role: string }>();

  if (!orgData || !['owner', 'admin'].includes(orgData.role)) {
    throw error(403, 'Only organization owners and admins can invite members');
  }

  const body = await request.json() as {
    githubUsername: string;
    role?: 'admin' | 'member';
  };

  const { githubUsername, role = 'member' } = body;

  if (!githubUsername) {
    throw error(400, 'GitHub username is required');
  }

  // Clean up the username (remove @ prefix if present)
  const cleanUsername = githubUsername.replace(/^@/, '').trim();

  // Look up user in authors table by GitHub username
  const author = await db.prepare(`
    SELECT id, username, user_id, display_name FROM authors WHERE username = ?
  `)
    .bind(cleanUsername)
    .first<{ id: string; username: string; user_id: string | null; display_name: string | null }>();

  if (!author) {
    throw error(404, `User @${cleanUsername} not found. They may not have signed up yet.`);
  }

  if (!author.user_id) {
    throw error(400, `User @${cleanUsername} has not signed up on SkillsCat yet. They need to sign in first.`);
  }

  // Check if already a member
  const existingMember = await db.prepare(`
    SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?
  `)
    .bind(orgData.org_id, author.user_id)
    .first();

  if (existingMember) {
    throw error(409, `@${cleanUsername} is already a member of this organization`);
  }

  // Check if there's already a pending invitation
  const existingInvite = await db.prepare(`
    SELECT id FROM notifications
    WHERE user_id = ? AND type = 'org_invite' AND processed = 0
    AND json_extract(metadata, '$.orgId') = ?
  `)
    .bind(author.user_id, orgData.org_id)
    .first();

  if (existingInvite) {
    throw error(409, `@${cleanUsername} already has a pending invitation to this organization`);
  }

  // Create notification for the invited user
  const notificationId = crypto.randomUUID();
  const orgDisplayName = orgData.display_name || orgData.org_name;
  const metadata = JSON.stringify({
    orgId: orgData.org_id,
    orgSlug: orgData.org_slug,
    orgName: orgDisplayName,
    inviterId: session.user.id,
    inviterName: session.user.name,
    role,
  });

  await db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, metadata, read, processed, created_at)
    VALUES (?, ?, 'org_invite', ?, ?, ?, 0, 0, ?)
  `)
    .bind(
      notificationId,
      author.user_id,
      `Invitation to join ${orgDisplayName}`,
      `${session.user.name} invited you to join ${orgDisplayName} as ${role === 'admin' ? 'an admin' : 'a member'}.`,
      metadata,
      Date.now()
    )
    .run();

  return json({
    success: true,
    message: `Invitation sent to @${cleanUsername}`,
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
