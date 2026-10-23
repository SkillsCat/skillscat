import type { SupportedLocale } from '$lib/i18n/config';

export type SeoLocale = 'en' | 'zh-CN' | 'ca';

export function getPathLocale(pathname: string): SeoLocale {
  if (pathname === '/zh-CN' || pathname.startsWith('/zh-CN/')) return 'zh-CN';
  if (pathname === '/ca' || pathname.startsWith('/ca/')) return 'ca';
  return 'en';
}

export function stripSeoLocale(pathname: string): string {
  const locale = getPathLocale(pathname);
  if (locale === 'en') return pathname;
  return pathname.slice(locale.length + 1) || '/';
}

// These articles are written in Catalan only; there are no English/Chinese
// equivalents. Keep their explicit routes, language and canonical URLs intact.
export function isCatalanEditorialPath(pathname: string): boolean {
  return /^\/ca\/(?:catala|blog(?:\/[^/]+)?)\/?$/.test(pathname);
}

export function isLocalizedPublicPath(pathname: string): boolean {
  const path = stripSeoLocale(pathname).replace(/\/+$/, '') || '/';
  return ['/', '/trending', '/recent', '/top', '/categories', '/search', '/docs', '/docs/cli', '/docs/openclaw'].includes(path)
    || /^\/category\/[^/]+$/.test(path) || /^\/skills\/[^/]+\/.+/.test(path);
}

export function localizeHref(href: string, locale: SupportedLocale, includeSkills = false): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const url = new URL(href, 'https://skills.cat');
  if (isCatalanEditorialPath(url.pathname)) return href;
  const path = stripSeoLocale(url.pathname);
  if (!isLocalizedPublicPath(path)) return href;
  // Chinese skill introductions are optional. Catalan translates the controls,
  // not third-party content, so its detail UI remains navigable for every skill.
  if (!includeSkills && locale !== 'ca' && path.startsWith('/skills/')) return href;
  const prefix = locale === 'zh-CN' || locale === 'ca' ? `/${locale}` : '';
  return `${prefix}${path === '/' && prefix ? '' : path}${url.search}${url.hash}`;
}

export function localizeSeoUrl(value: string, locale: SupportedLocale, includeSkills = true): string {
  if (value === 'https://skills.cat' || value.startsWith('https://skills.cat/')) {
    return `https://skills.cat${localizeHref(value.slice('https://skills.cat'.length) || '/', locale, includeSkills)}`;
  }
  return localizeHref(value, locale, includeSkills);
}

export function localizeStructuredData(value: unknown, locale: SupportedLocale, readySkillUrl?: string): unknown {
  if (typeof value === 'string') return localizeSeoUrl(value, locale, Boolean(readySkillUrl && value.split('#')[0] === readySkillUrl));
  if (Array.isArray(value)) return value.map((item) => localizeStructuredData(item, locale, readySkillUrl));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, key === 'inLanguage' ? (locale === 'zh-CN' || locale === 'ca' ? locale : 'en') : localizeStructuredData(item, locale, readySkillUrl)])
  );
  return value;
}
