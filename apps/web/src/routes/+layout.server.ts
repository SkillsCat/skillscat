import type { LayoutServerLoad } from './$types';
import { AVAILABLE_LOCALES } from '$lib/i18n/config';
import type { CurrentUser } from '$lib/types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const currentUser: CurrentUser | null = locals.user
    ? {
        id: locals.user.id,
        name: locals.user.name ?? null,
        email: locals.user.email ?? null,
        image: locals.user.image ?? null,
      }
    : null;

  // Keep root layout server load non-blocking for navigations.
  // Unread notifications are fetched client-side from /api/notifications/unread-count.
  return {
    currentUser,
    unreadCount: 0,
    locale: locals.locale,
    localeSource: locals.localeSource,
    htmlLang: locals.htmlLang,
    availableLocales: AVAILABLE_LOCALES,
  };
};
