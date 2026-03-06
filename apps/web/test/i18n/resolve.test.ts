import { describe, expect, it } from 'vitest';

import {
  getLocaleFromAcceptLanguage,
  normalizeLocale,
  resolveRequestLocale,
} from '../../src/lib/i18n/resolve';

describe('normalizeLocale', () => {
  it('normalizes supported locale variants', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-SG')).toBe('zh-CN');
    expect(normalizeLocale('zh-TW')).toBe('zh-CN');
    expect(normalizeLocale('zh-HK')).toBe('zh-CN');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('ko-KR')).toBe('ko');
  });

  it('returns null for unsupported or empty values', () => {
    expect(normalizeLocale('fr-FR')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
  });
});

describe('getLocaleFromAcceptLanguage', () => {
  it('selects the highest-priority supported locale', () => {
    expect(getLocaleFromAcceptLanguage('fr-FR, en-US;q=0.9, ja-JP;q=0.8')).toBe('en');
    expect(getLocaleFromAcceptLanguage('fr-FR, ko-KR;q=0.6, ja-JP;q=0.7')).toBe('ja');
  });

  it('falls back to null when the header has no supported locale', () => {
    expect(getLocaleFromAcceptLanguage('fr-FR, de-DE;q=0.8')).toBeNull();
    expect(getLocaleFromAcceptLanguage(undefined)).toBeNull();
  });
});

describe('resolveRequestLocale', () => {
  it('prefers the locale cookie over accept-language', () => {
    expect(
      resolveRequestLocale({
        cookieLocale: 'ko-KR',
        acceptLanguage: 'ja-JP, en-US;q=0.9',
      })
    ).toEqual({
      locale: 'ko',
      source: 'cookie',
    });
  });

  it('uses accept-language when the cookie is invalid', () => {
    expect(
      resolveRequestLocale({
        cookieLocale: 'fr-FR',
        acceptLanguage: 'zh-CN, en-US;q=0.9',
      })
    ).toEqual({
      locale: 'zh-CN',
      source: 'accept-language',
    });
  });

  it('falls back to the default locale when nothing matches', () => {
    expect(
      resolveRequestLocale({
        cookieLocale: 'bad-value',
        acceptLanguage: 'fr-FR, de-DE;q=0.8',
      })
    ).toEqual({
      locale: 'en',
      source: 'default',
    });
  });
});
