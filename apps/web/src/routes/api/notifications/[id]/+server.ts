import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * PATCH /api/notifications/[id] - Mark notification as read/processed
 */
export const PATCH: RequestHandler = async ({ locals, platform, params, request }) => {
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

  // Verify ownership
  const notification = await db.prepare(`
    SELECT id, user_id FROM notifications WHERE id = ?
  `)
    .bind(id)
    .first<{ id: string; user_id: string }>();

  if (!notification) {
    throw error(404, 'Notification not found');
  }

  if (notification.user_id !== session.user.id) {
    throw error(403, 'Not authorized to update this notification');
  }

  const body = await request.json() as { read?: boolean; processed?: boolean };
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.read !== undefined) {
    updates.push('read = ?');
    values.push(body.read ? 1 : 0);
  }

  if (body.processed !== undefined) {
    updates.push('processed = ?');
    values.push(body.processed ? 1 : 0);
    if (body.processed) {
      updates.push('processed_at = ?');
      values.push(Date.now());
    }
  }

  if (updates.length === 0) {
    throw error(400, 'No updates provided');
  }

  values.push(id);
  await db.prepare(`
    UPDATE notifications SET ${updates.join(', ')} WHERE id = ?
  `)
    .bind(...values)
    .run();

  return json({
    success: true,
    message: 'Notification updated',
  });
};
