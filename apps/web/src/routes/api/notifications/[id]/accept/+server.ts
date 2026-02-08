import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface OrgInviteMetadata {
  orgId: string;
  orgSlug: string;
  orgName: string;
  inviterId: string;
  inviterName: string;
  role: 'admin' | 'member';
}

function parseOrgInviteMetadata(raw: string): OrgInviteMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw error(400, 'Invalid invitation data');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw error(400, 'Invalid invitation data');
  }

  const candidate = parsed as Record<string, unknown>;
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId : '';
  const orgSlug = typeof candidate.orgSlug === 'string' ? candidate.orgSlug : '';
  const orgName = typeof candidate.orgName === 'string' ? candidate.orgName : '';
  const inviterId = typeof candidate.inviterId === 'string' ? candidate.inviterId : '';
  const inviterName = typeof candidate.inviterName === 'string' ? candidate.inviterName : '';
  const role = candidate.role === 'admin' || candidate.role === 'member' ? candidate.role : null;

  if (!orgId || !orgSlug || !orgName || !inviterId || !inviterName || !role) {
    throw error(400, 'Invalid invitation data');
  }

  return {
    orgId,
    orgSlug,
    orgName,
    inviterId,
    inviterName,
    role,
  };
}

/**
 * POST /api/notifications/[id]/accept - Accept an org invitation
 */
export const POST: RequestHandler = async ({ locals, platform, params }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const { id } = params;
  if (!id) {
    throw error(400, 'Notification ID is required');
  }

  // Get notification and verify ownership
  const notification = await db.prepare(`
    SELECT id, user_id, type, metadata, processed FROM notifications WHERE id = ?
  `)
    .bind(id)
    .first<{ id: string; user_id: string; type: string; metadata: string | null; processed: number }>();

  if (!notification) {
    throw error(404, 'Notification not found');
  }

  if (notification.user_id !== session.user.id) {
    throw error(403, 'Not authorized to accept this invitation');
  }

  if (notification.type !== 'org_invite') {
    throw error(400, 'This notification is not an organization invitation');
  }

  if (notification.processed) {
    throw error(400, 'This invitation has already been processed');
  }

  if (!notification.metadata) {
    throw error(400, 'Invalid invitation data');
  }

  const metadata = parseOrgInviteMetadata(notification.metadata);

  // Check if already a member
  const existing = await db.prepare(`
    SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?
  `)
    .bind(metadata.orgId, session.user.id)
    .first();

  if (existing) {
    // Already a member, just mark as processed
    await db.prepare(`
      UPDATE notifications SET processed = 1, processed_at = ?, read = 1 WHERE id = ?
    `)
      .bind(Date.now(), id)
      .run();

    return json({
      success: true,
      message: 'You are already a member of this organization',
    });
  }

  // Add user to organization
  await db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, invited_by, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `)
    .bind(metadata.orgId, session.user.id, metadata.role, metadata.inviterId, Date.now())
    .run();

  // Mark notification as processed
  await db.prepare(`
    UPDATE notifications SET processed = 1, processed_at = ?, read = 1 WHERE id = ?
  `)
    .bind(Date.now(), id)
    .run();

  return json({
    success: true,
    message: `You have joined ${metadata.orgName}`,
    orgSlug: metadata.orgSlug,
  });
};
