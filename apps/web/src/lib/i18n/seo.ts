import { getOgLocale, type SupportedLocale } from '$lib/i18n/config';

export function getSeoLocaleMetadata(locale: SupportedLocale): {
  ogLocale: string;
  alternateLocales: string[];
} {
  return {
    ogLocale: getOgLocale(locale),
    alternateLocales: [],
  };
}
