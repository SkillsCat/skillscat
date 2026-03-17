import { describe, expect, it } from 'vitest';
import { detectRegistrySkillPlatform, parseRegistrySearchInput } from '../src/lib/server/registry/search';

describe('parseRegistrySearchInput', () => {
  it('normalizes cli-style and tool-style inputs', () => {
    expect(
      parseRegistrySearchInput({
        query: '  react  ',
        category: 'UI-Components',
        limit: '500',
        offset: '-3',
        includePrivate: true,
      })
    ).toEqual({
      query: 'react',
      category: 'ui-components',
      limit: 100,
      offset: 0,
      includePrivate: true,
    });

    expect(
      parseRegistrySearchInput({
        q: 'svelte',
        category: 'not valid!',
        pageSize: '3',
        include_private: 'true',
      })
    ).toEqual({
      query: 'svelte',
      category: '',
      limit: 3,
      offset: 0,
      includePrivate: true,
    });
  });
});

describe('detectRegistrySkillPlatform', () => {
  it('detects gitlab urls and defaults to github', () => {
    expect(detectRegistrySkillPlatform('https://gitlab.com/org/repo')).toBe('gitlab');
    expect(detectRegistrySkillPlatform('https://github.com/org/repo')).toBe('github');
    expect(detectRegistrySkillPlatform(null)).toBe('github');
  });
});
