import { localizeHref, isLocalizedPublicPath, isCatalanEditorialPath, getPathLocale, stripSeoLocale } from '$lib/seo/locale-path';
import { browser } from '$app/environment';
import { invalidateAll } from '$app/navigation';
import { getContext, setContext } from 'svelte';
import {
  AVAILABLE_LOCALES,
  getIntlLocale,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  type SupportedLocale,
} from '$lib/i18n/config';
import { getHtmlLang } from '$lib/i18n/resolve';
import { formatMessage, getMessages, type MessageCatalog } from '$lib/i18n/messages';

const I18N_CONTEXT = Symbol('skillscat.i18n');

export interface I18nRuntime {
  locale: () => SupportedLocale;
  htmlLang: () => string;
  messages: () => MessageCatalog;
  availableLocales: () => typeof AVAILABLE_LOCALES;
  t: (template: string, values?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
  formatCompactNumber: (value: number) => string;
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  href: (href: string) => string;
  switchLocale: (nextLocale: SupportedLocale) => Promise<void>;
}

export function setLocaleCookie(locale: SupportedLocale): void {
  if (!browser) return;

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

// Remember explicit public URLs in both directions, including browser history
// restoration. Japanese/Korean still use cookies on unprefixed pages; an English
// documentation fallback must not erase those existing preferences.
function isDocsPath(pathname: string): boolean {
  return /^\/docs(?:\/cli|\/openclaw)?\/?$/.test(stripSeoLocale(pathname));
}

export function rememberPathLocale(pathname: string, renderedLocale: SupportedLocale): void {
  if (!browser || (!isLocalizedPublicPath(pathname) && !isCatalanEditorialPath(pathname))) return;
  const pathLocale = getPathLocale(pathname);
  const savedLocale = document.cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE_NAME}=`))?.slice(LOCALE_COOKIE_NAME.length + 1);
  if (pathLocale === 'en' && renderedLocale === 'en' && isDocsPath(pathname)
    && (savedLocale === 'ja' || savedLocale === 'ko')) return;
  const preference = pathLocale === 'en' ? renderedLocale : pathLocale;
  if (savedLocale !== preference) setLocaleCookie(preference);
}

export function createI18nRuntime(input: {
  getLocale: () => SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}): I18nRuntime {
  // A page may render dozens of cards. Intl constructors are much more costly
  // than format(), so reuse the two number formatters for each visited locale.
  const numberFormats = new Map<SupportedLocale, Intl.NumberFormat>();
  const compactFormats = new Map<SupportedLocale, Intl.NumberFormat>();
  function numberFormat(compact = false): Intl.NumberFormat {
    const locale = input.getLocale();
    const formats = compact ? compactFormats : numberFormats;
    let formatter = formats.get(locale);
    if (!formatter) {
      formatter = new Intl.NumberFormat(getIntlLocale(locale), compact
        ? { notation: 'compact', maximumFractionDigits: 1 } : undefined);
      formats.set(locale, formatter);
    }
    return formatter;
  }
  return {
    locale: () => input.getLocale(),
    href: (href) => localizeHref(href, input.getLocale()),
    htmlLang: () => getHtmlLang(input.getLocale()),
    messages: () => getMessages(input.getLocale()),
    availableLocales: () => AVAILABLE_LOCALES,
    t: (template, values) => formatMessage(template, values),
    formatNumber: (value) => numberFormat().format(value),
    formatCompactNumber: (value) => numberFormat(true).format(value),
    formatDate: (value, options) =>
      new Intl.DateTimeFormat(getIntlLocale(input.getLocale()), options).format(
        value instanceof Date ? value : new Date(value)
      ),
    switchLocale: async (nextLocale) => {
      if (nextLocale === input.getLocale()) return;

      setLocaleCookie(nextLocale);
      // Editorial content has no translated equivalent. Japanese/Korean docs
      // also have no localized route: their unprefixed SSR fallback is English.
      // In both cases use the chosen homepage instead of resetting the selector.
      const needsDocsFallback = browser && (nextLocale === 'ja' || nextLocale === 'ko')
        && isDocsPath(window.location.pathname);
      if (browser && (isCatalanEditorialPath(window.location.pathname) || needsDocsFallback)) {
        window.location.assign(localizeHref('/', nextLocale));
        return;
      }
      if (browser && isLocalizedPublicPath(window.location.pathname)) {
        window.location.assign(localizeHref(window.location.pathname + window.location.search + window.location.hash, nextLocale, true));
        return;
      }
      input.setLocale(nextLocale);

      if (browser) {
        document.documentElement.lang = getHtmlLang(nextLocale);
      }

      await invalidateAll();
    },
  };
}

export function setI18nContext(runtime: I18nRuntime): void {
  setContext(I18N_CONTEXT, runtime);
}

export function useI18n(): I18nRuntime {
  const runtime = getContext<I18nRuntime>(I18N_CONTEXT);
  if (!runtime) {
    throw new Error('Missing i18n context');
  }
  return runtime;
}
