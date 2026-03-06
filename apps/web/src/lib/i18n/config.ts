export const LOCALES = ['en', 'zh-CN', 'ja', 'ko'] as const;

export type SupportedLocale = (typeof LOCALES)[number];
export type LocaleSource = 'cookie' | 'accept-language' | 'default';

export const DEFAULT_LOCALE: SupportedLocale = 'en';
export const LOCALE_COOKIE_NAME = 'sc_locale';
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const INTL_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
};

export const OG_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en_US',
  'zh-CN': 'zh_CN',
  ja: 'ja_JP',
  ko: 'ko_KR',
};

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
};

export const AVAILABLE_LOCALES = LOCALES.map((code) => ({
  code,
  label: LOCALE_LABELS[code],
})) as ReadonlyArray<{ code: SupportedLocale; label: string }>;

export function getIntlLocale(locale: SupportedLocale): string {
  return INTL_LOCALE_MAP[locale];
}

export function getOgLocale(locale: SupportedLocale): string {
  return OG_LOCALE_MAP[locale];
}
