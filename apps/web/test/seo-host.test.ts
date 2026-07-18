import { describe, expect, it } from 'vitest';

import { getCanonicalHostRedirectLocation } from '../src/lib/server/seo/host';

describe('canonical host redirects', () => {
  it('redirects www URLs to the configured apex origin and preserves path and query', () => {
    expect(getCanonicalHostRedirectLocation(
      new URL('https://www.skills.cat/skills/acme/demo?page=2'),
      'https://skills.cat'
    )).toBe('https://skills.cat/skills/acme/demo?page=2');
  });

  it('does not redirect the apex, preview hosts, or invalid configuration', () => {
    expect(getCanonicalHostRedirectLocation(
      new URL('https://skills.cat/trending'),
      'https://skills.cat'
    )).toBeNull();
    expect(getCanonicalHostRedirectLocation(
      new URL('https://preview.skills.cat/trending'),
      'https://skills.cat'
    )).toBeNull();
    expect(getCanonicalHostRedirectLocation(
      new URL('https://www.skills.cat/trending'),
      'not-a-url'
    )).toBeNull();
  });
});
