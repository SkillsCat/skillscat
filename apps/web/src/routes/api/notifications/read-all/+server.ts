import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/notifications/read-all - Mark all notifications as read
 */
export const POST: RequestHandler = async ({ locals, platform }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw error(401, 'Authentication required');
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  await db.prepare(`
    UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0
  `)
    .bind(session.user.id)
    .run();

  return json({
    success: true,
    message: 'All notifications marked as read',
  });
};
