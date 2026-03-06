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
  switchLocale: (nextLocale: SupportedLocale) => Promise<void>;
}

function setLocaleCookie(locale: SupportedLocale): void {
  if (!browser) return;

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function createI18nRuntime(input: {
  getLocale: () => SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}): I18nRuntime {
  return {
    locale: () => input.getLocale(),
    htmlLang: () => getHtmlLang(input.getLocale()),
    messages: () => getMessages(input.getLocale()),
    availableLocales: () => AVAILABLE_LOCALES,
    t: (template, values) => formatMessage(template, values),
    formatNumber: (value) => new Intl.NumberFormat(getIntlLocale(input.getLocale())).format(value),
    formatCompactNumber: (value) =>
      new Intl.NumberFormat(getIntlLocale(input.getLocale()), {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value),
    formatDate: (value, options) =>
      new Intl.DateTimeFormat(getIntlLocale(input.getLocale()), options).format(
        value instanceof Date ? value : new Date(value)
      ),
    switchLocale: async (nextLocale) => {
      if (nextLocale === input.getLocale()) return;

      input.setLocale(nextLocale);
      setLocaleCookie(nextLocale);

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
