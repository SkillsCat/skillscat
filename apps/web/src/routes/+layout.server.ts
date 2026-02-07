import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
  const user = locals.user;
  if (!user) {
    return { unreadCount: 0 };
  }

  const db = platform?.env?.DB;
  if (!db) {
    return { unreadCount: 0 };
  }

  try {
    const result = await db
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0')
      .bind(user.id)
      .first<{ count: number }>();
    return { unreadCount: result?.count ?? 0 };
  } catch {
    return { unreadCount: 0 };
  }
};
