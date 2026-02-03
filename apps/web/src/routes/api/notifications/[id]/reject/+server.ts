import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/notifications/[id]/reject - Reject an org invitation
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
    SELECT id, user_id, type, processed FROM notifications WHERE id = ?
  `)
    .bind(id)
    .first<{ id: string; user_id: string; type: string; processed: number }>();

  if (!notification) {
    throw error(404, 'Notification not found');
  }

  if (notification.user_id !== session.user.id) {
    throw error(403, 'Not authorized to reject this invitation');
  }

  if (notification.type !== 'org_invite') {
    throw error(400, 'This notification is not an organization invitation');
  }

  if (notification.processed) {
    throw error(400, 'This invitation has already been processed');
  }

  // Mark notification as processed (rejected)
  await db.prepare(`
    UPDATE notifications SET processed = 1, processed_at = ?, read = 1 WHERE id = ?
  `)
    .bind(Date.now(), id)
    .run();

  return json({
    success: true,
    message: 'Invitation declined',
  });
};
