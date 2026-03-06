import { describe, expect, it } from 'vitest';

import {
  getLocalizedCategoryBySlug,
  localizeCategory,
  localizeCategorySection,
} from '../../src/lib/i18n/categories';
import type { Category, CategorySection } from '../../src/lib/constants/categories';

describe('category localization', () => {
  it('localizes built-in categories without changing their keywords', () => {
    const category = getLocalizedCategoryBySlug('git', 'zh-CN');

    expect(category).toBeDefined();
    expect(category?.name).toBe('Git 与版本控制');
    expect(category?.description).toBe('Git 操作、提交助手与分支管理');
    expect(category?.keywords).toContain('github');
  });

  it('localizes built-in section names and nested categories', () => {
    const section: CategorySection = {
      id: 'development',
      name: 'Development',
      categories: [
        {
          slug: 'testing',
          name: 'Testing',
          description: 'Unit tests',
          keywords: ['vitest'],
        },
      ],
    };

    const localized = localizeCategorySection(section, 'ja');

    expect(localized.name).toBe('開発');
    expect(localized.categories[0]?.name).toBe('テスト');
    expect(localized.categories[0]?.keywords).toEqual(['vitest']);
  });

  it('leaves non-built-in categories untouched', () => {
    const category: Category = {
      slug: 'community-custom',
      name: 'Community Custom',
      description: 'User-defined category',
      keywords: ['custom'],
    };

    expect(localizeCategory(category, 'ko')).toEqual(category);
    expect(getLocalizedCategoryBySlug('community-custom', 'ko')).toBeUndefined();
  });
});
