import {
  DEFAULT_LOCALE,
  type LocaleSource,
  type SupportedLocale,
} from '$lib/i18n/config';

function normalizeLanguageTag(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  const tag = normalizeLanguageTag(value);
  if (!tag) return null;

  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
  if (tag === 'ko' || tag.startsWith('ko-')) return 'ko';
  if (tag === 'zh' || tag.startsWith('zh-')) {
    return 'zh-CN';
  }

  return null;
}

function parseQuality(part: string): number {
  const segments = part.split(';').slice(1);
  for (const segment of segments) {
    const [key, rawValue] = segment.split('=').map((item) => item.trim());
    if (key === 'q') {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 1;
}

export function getLocaleFromAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
  if (!header) return null;

  const candidates = header
    .split(',')
    .map((part) => {
      const [tag] = part.split(';');
      return {
        locale: normalizeLocale(tag),
        quality: parseQuality(part),
      };
    })
    .filter((candidate): candidate is { locale: SupportedLocale; quality: number } => Boolean(candidate.locale))
    .sort((a, b) => b.quality - a.quality);

  return candidates[0]?.locale ?? null;
}

export function resolveRequestLocale(input: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): { locale: SupportedLocale; source: LocaleSource } {
  const cookieLocale = normalizeLocale(input.cookieLocale);
  if (cookieLocale) {
    return { locale: cookieLocale, source: 'cookie' };
  }

  const headerLocale = getLocaleFromAcceptLanguage(input.acceptLanguage);
  if (headerLocale) {
    return { locale: headerLocale, source: 'accept-language' };
  }

  return { locale: DEFAULT_LOCALE, source: 'default' };
}

export function getHtmlLang(locale: SupportedLocale): string {
  return locale;
}
