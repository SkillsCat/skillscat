import { describe, expect, it } from 'vitest';

import { getSeoLocaleMetadata } from '../../src/lib/i18n/seo';

describe('getSeoLocaleMetadata', () => {
  it('maps each supported locale to the correct og:locale', () => {
    expect(getSeoLocaleMetadata('en')).toEqual({
      ogLocale: 'en_US',
      alternateLocales: [],
    });
    expect(getSeoLocaleMetadata('zh-CN')).toEqual({
      ogLocale: 'zh_CN',
      alternateLocales: [],
    });
    expect(getSeoLocaleMetadata('ja')).toEqual({
      ogLocale: 'ja_JP',
      alternateLocales: [],
    });
    expect(getSeoLocaleMetadata('ko')).toEqual({
      ogLocale: 'ko_KR',
      alternateLocales: [],
    });
  });
});
