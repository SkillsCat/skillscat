import { describe, expect, it, vi } from 'vitest';
import { formatRelativeTimestamp } from '$lib/i18n/relative';
import type { I18nRuntime } from '$lib/i18n/runtime';
import { CATEGORIES, CATEGORY_SECTIONS } from '$lib/constants/categories';
import { getMessages, formatMessage } from '$lib/i18n/messages';
import { getSkillPageCopy } from '$lib/i18n/skill-page';
import { getProfilesCopy } from '$lib/i18n/profiles';
import { getSettingsCopy } from '$lib/i18n/settings';
import { getDocsCopy } from '$lib/i18n/docs';
import { getUiCopy } from '$lib/i18n/ui';
import { getLocalizedCategoryBySlug, getLocalizedCategorySections } from '$lib/i18n/categories';

function flattenStrings(value: unknown, prefix = ''): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof item === 'string'
      ? [[path, item]]
      : Object.entries(flattenStrings(item, path));
  }));
}

function placeholders(value: string): string[] {
  return (value.match(/\{\w+\}/g) ?? []).sort();
}

describe('Catalan core catalogs', () => {
  it.each([
    ['main interface', getMessages('en'), getMessages('ca')],
    ['skill detail', getSkillPageCopy('en'), getSkillPageCopy('ca')],
    ['common badges', getUiCopy('en'), getUiCopy('ca')],
    ['settings', getSettingsCopy('en'), getSettingsCopy('ca')],
    ['documentation metadata', getDocsCopy('en'), getDocsCopy('ca')],
  ])('provides every %s key and preserves interpolation placeholders', (_name, english, catalan) => {
    const source = flattenStrings(english);
    const translated = flattenStrings(catalan);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(source).sort());
    for (const [key, value] of Object.entries(translated)) {
      expect(value.trim(), key).not.toBe('');
      expect(placeholders(value), key).toEqual(placeholders(source[key]));
    }
  });

  it('preserves profile placeholders except the English-only plural suffix', () => {
    const source = flattenStrings(getProfilesCopy('en'));
    const translated = flattenStrings(getProfilesCopy('ca'));
    expect(Object.keys(translated).sort()).toEqual(Object.keys(source).sort());
    for (const [key, value] of Object.entries(translated)) {
      const sourceTokens = placeholders(source[key]);
      // These Catalan count labels are neutral (e.g. Membres: 1), so the
      // English {suffix} token is intentionally not used.
      const expected = ['org.memberCount', 'org.skillCount'].includes(key)
        ? sourceTokens.filter((token) => token !== '{suffix}') : sourceTokens;
      expect(placeholders(value), key).toEqual(expected);
    }
  });

  it('translates the discovery, search, installation, and footer flows', () => {
    const messages = getMessages('ca');
    expect(messages.nav.searchSkills).toBe('Cerca skills…');
    expect(messages.home.heroTitle).toContain('plataforma oberta');
    expect(messages.footer.language).toBe('Llengua');
    expect(messages.installDialog.installToLocalDirectory).toBe('Instal·la en un directori local');
    expect(formatMessage(messages.searchPage.summary, { skills: 4, categories: 2, query: 'català' }))
      .toBe('Resultats per a «català» — Skills: 4; categories: 2');
    expect(formatMessage(messages.searchPage.summary, { skills: 1, categories: 1, query: 'català' }))
      .toBe('Resultats per a «català» — Skills: 1; categories: 1');
  });

  it('translates all built-in category descriptions and section names', () => {
    const sections = getLocalizedCategorySections('ca');
    expect(sections).toHaveLength(CATEGORY_SECTIONS.length);
    expect(sections.find((section) => section.id === 'development')?.name).toBe('Desenvolupament');
    for (const category of CATEGORIES) {
      const translated = getLocalizedCategoryBySlug(category.slug, 'ca');
      expect(translated?.slug).toBe(category.slug);
      expect(translated?.description, category.slug).not.toBe(category.description);
    }
  });


  it('uses singular and plural Catalan month and year labels', () => {
    const now = new Date('2026-10-23T12:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const i18n = { t: formatMessage } as I18nRuntime;
      const messages = getMessages('ca');
      const ago = (days: number) => formatRelativeTimestamp(i18n, messages, now - days * 86_400_000);
      expect(ago(40)).toBe('fa 1 mes');
      expect(ago(60)).toBe('fa 2 mesos');
      expect(ago(365)).toBe('fa 1 any');
      expect(ago(730)).toBe('fa 2 anys');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('does not claim the author content is translated or scans guarantee safety', () => {
    const copy = getSkillPageCopy('ca');
    expect(copy.originalContentLabel).toContain('llengua no indicada');
    expect(copy.originalContentNote).toContain('sense traduir');
    expect(copy.securityNoFindings).toContain('no garanteix');
    expect(getMessages('ca').lists.topDescription).not.toContain('garantida');
  });
});
