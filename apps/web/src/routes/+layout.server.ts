import type { LayoutServerLoad } from './$types';
import { AVAILABLE_LOCALES } from '$lib/i18n/config';

export const load: LayoutServerLoad = async ({ locals }) => {
  // Keep root layout server load non-blocking for navigations.
  // Unread notifications are fetched client-side from /api/notifications/unread-count.
  return {
    unreadCount: 0,
    locale: locals.locale,
    localeSource: locals.localeSource,
    htmlLang: locals.htmlLang,
    availableLocales: AVAILABLE_LOCALES,
  };
};
