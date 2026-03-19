import { describe, expect, it } from 'vitest';

import { resolveRequestLocale } from '../src/lib/i18n/resolve';
import {
  shouldForceDefaultLocaleForPublicPage,
  shouldUseDefaultLocaleForIndexablePage,
} from '../src/lib/server/seo/locale';

describe('resolveRequestLocale', () => {
  it('collapses anonymous indexable pages to the default locale', () => {
    const result = resolveRequestLocale({
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
      preferDefaultLocale: true,
    });

    expect(result).toEqual({
      locale: 'en',
      source: 'default',
    });
  });

  it('still honors an explicit locale cookie even when indexable pages default to english', () => {
    const result = resolveRequestLocale({
      cookieLocale: 'ja',
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
      preferDefaultLocale: true,
    });

    expect(result).toEqual({
      locale: 'ja',
      source: 'cookie',
    });
  });
});

describe('shouldUseDefaultLocaleForIndexablePage', () => {
  it('returns true for crawlable public html pages', () => {
    expect(shouldUseDefaultLocaleForIndexablePage('/', 'GET')).toBe(true);
    expect(shouldUseDefaultLocaleForIndexablePage('/skills/testowner/demo-skill', 'HEAD')).toBe(
      true
    );
    expect(shouldUseDefaultLocaleForIndexablePage('/docs', 'GET')).toBe(true);
  });

  it('returns false for noindex or non-html routes', () => {
    expect(shouldUseDefaultLocaleForIndexablePage('/search', 'GET')).toBe(false);
    expect(shouldUseDefaultLocaleForIndexablePage('/device', 'GET')).toBe(false);
    expect(shouldUseDefaultLocaleForIndexablePage('/sitemap.xml', 'GET')).toBe(false);
    expect(shouldUseDefaultLocaleForIndexablePage('/api/search', 'GET')).toBe(false);
    expect(shouldUseDefaultLocaleForIndexablePage('/llm.txt', 'GET')).toBe(false);
    expect(shouldUseDefaultLocaleForIndexablePage('/trending', 'POST')).toBe(false);
  });
});

describe('shouldForceDefaultLocaleForPublicPage', () => {
  it('forces english for docs pages even if a user has a locale cookie', () => {
    expect(shouldForceDefaultLocaleForPublicPage('/docs', 'GET')).toBe(true);
    expect(shouldForceDefaultLocaleForPublicPage('/docs/cli', 'GET')).toBe(true);
    expect(shouldForceDefaultLocaleForPublicPage('/docs/openclaw', 'HEAD')).toBe(true);
  });

  it('does not force english for other public or non-html routes', () => {
    expect(shouldForceDefaultLocaleForPublicPage('/trending', 'GET')).toBe(false);
    expect(shouldForceDefaultLocaleForPublicPage('/search', 'GET')).toBe(false);
    expect(shouldForceDefaultLocaleForPublicPage('/docs', 'POST')).toBe(false);
  });
});
