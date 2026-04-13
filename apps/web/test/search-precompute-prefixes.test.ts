import { describe, expect, it } from 'vitest';

import {
  buildSearchPrefixEntries,
  SEARCH_SUGGESTION_MAX_PREFIX_LENGTH,
} from '../src/lib/server/ranking/search-precompute';

describe('search suggestion prefix precompute', () => {
  it('builds bounded prefixes from high-signal fields only', () => {
    const prefixes = buildSearchPrefixEntries({
      name: 'React Toolkit',
      slug: 'react-toolkit',
      repoOwner: 'acme',
      repoName: 'skills',
      description: 'Hidden recommendation helper',
      categories: ['automation'],
      tags: ['agentic-workflows'],
    });

    const prefixSet = new Set(prefixes.map((entry) => entry.prefix));

    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.every((entry) => entry.prefix.length >= 2)).toBe(true);
    expect(prefixes.every((entry) => entry.prefix.length <= SEARCH_SUGGESTION_MAX_PREFIX_LENGTH)).toBe(true);
    expect(prefixSet.has('re')).toBe(true);
    expect(prefixSet.has('react')).toBe(true);
    expect(prefixSet.has('au')).toBe(true);
    expect(prefixSet.has('agentic')).toBe(true);
    expect(prefixSet.has('hi')).toBe(false);
    expect(prefixSet.has('hidd')).toBe(false);
  });
});
