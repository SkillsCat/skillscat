import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface OrgInviteMetadata {
  orgId: string;
  orgSlug: string;
  orgName: string;
  inviterId: string;
  inviterName: string;
  role: 'admin' | 'member';
}

function parseOrgInviteMetadata(raw: string | null): OrgInviteMetadata | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  const role = candidate.role === 'admin' || candidate.role === 'member' ? candidate.role : null;

  if (
    typeof candidate.orgId !== 'string' ||
    typeof candidate.orgSlug !== 'string' ||
    typeof candidate.orgName !== 'string' ||
    typeof candidate.inviterId !== 'string' ||
    typeof candidate.inviterName !== 'string' ||
    role === null
  ) {
    return null;
  }

  return {
    orgId: candidate.orgId,
    orgSlug: candidate.orgSlug,
    orgName: candidate.orgName,
    inviterId: candidate.inviterId,
    inviterName: candidate.inviterName,
    role,
  };
}

export const load: PageServerLoad = async ({ locals, platform }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const results = await db.prepare(`
    SELECT id, type, title, message, metadata, read, processed, created_at, processed_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `)
    .bind(session.user.id)
    .all<{
      id: string;
      type: string;
      title: string;
      message: string | null;
      metadata: string | null;
      read: number;
      processed: number;
      created_at: number;
      processed_at: number | null;
    }>();

  return {
    notifications: results.results.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      metadata: parseOrgInviteMetadata(notification.metadata),
      read: Boolean(notification.read),
      processed: Boolean(notification.processed),
      createdAt: notification.created_at,
      processedAt: notification.processed_at,
    })),
  };
};
