import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
  // Keep root layout server load non-blocking for navigations.
  // Unread notifications are fetched client-side from /api/notifications/unread-count.
  return { unreadCount: 0 };
};
