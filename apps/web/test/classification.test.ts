import { describe, expect, it } from 'vitest';
import { classifyByKeywords } from '../workers/classification';

describe('classifyByKeywords', () => {
  it('keeps weak secondary keyword matches out of the assigned categories', () => {
    const result = classifyByKeywords(
      `
      This skill improves SEO for websites.
      It updates sitemap files, canonical tags, metadata, and search ranking signals.
      The workflow audits SEO metadata and generates sitemap improvements for better search visibility.
      It can also review a page before publishing.
      `,
      ['seo']
    );

    expect(result.categories).toEqual(['seo']);
  });

  it('keeps strong secondary categories when evidence is comparable', () => {
    const result = classifyByKeywords(
      `
      This skill audits application security and authentication flows.
      It checks oauth login, session handling, authorization rules, and vulnerability findings.
      The workflow reviews auth configuration and security issues before release.
      `
    );

    expect(result.categories).toContain('auth');
    expect(result.categories).toContain('security');
  });
});
