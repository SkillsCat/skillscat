import type { SupportedLocale } from '$lib/i18n/config';

export function stripSeoLocale(pathname: string): string {
  return pathname === '/zh-CN' ? '/' : pathname.startsWith('/zh-CN/') ? pathname.slice(6) : pathname;
}

export function isLocalizedPublicPath(pathname: string): boolean {
  const path = stripSeoLocale(pathname).replace(/\/+$/, '') || '/';
  return ['/', '/trending', '/recent', '/top', '/categories', '/docs', '/docs/cli', '/docs/openclaw'].includes(path)
    || /^\/category\/[^/]+$/.test(path) || /^\/skills\/[^/]+\/.+/.test(path);
}

export function localizeHref(href: string, locale: SupportedLocale, includeSkills = false): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const url = new URL(href, 'https://skills.cat');
  const path = stripSeoLocale(url.pathname);
  if (!isLocalizedPublicPath(path) || (!includeSkills && path.startsWith('/skills/'))) return href;
  return `${locale === 'zh-CN' ? '/zh-CN' : ''}${path === '/' && locale === 'zh-CN' ? '' : path}${url.search}${url.hash}`;
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
    Object.entries(value).map(([key, item]) => [key, key === 'inLanguage' ? (locale === 'zh-CN' ? 'zh-CN' : 'en') : localizeStructuredData(item, locale, readySkillUrl)])
  );
  return value;
}
