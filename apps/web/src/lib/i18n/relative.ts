import type { MessageCatalog } from '$lib/i18n/messages';
import type { I18nRuntime } from '$lib/i18n/runtime';

export function formatRelativeTimestamp(
  i18n: I18nRuntime,
  messages: MessageCatalog,
  timestamp: number
): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) return messages.common.justNow;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return i18n.t(messages.common.relativeMinutesAgo, { count: minutes });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return i18n.t(messages.common.relativeHoursAgo, { count: hours });
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return i18n.t(messages.common.relativeDaysAgo, { count: days });
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return i18n.t(messages.common.relativeWeeksAgo, { count: weeks });
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return i18n.t(messages.common.relativeMonthsAgo, { count: months });
  }

  const years = Math.floor(days / 365);
  return i18n.t(messages.common.relativeYearsAgo, { count: years });
}
