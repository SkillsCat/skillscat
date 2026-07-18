import { describe, expect, it } from 'vitest';

import {
  decodeXml,
  extractSitemapEntries,
  extractUrlEntries,
  isFreshSitemapDate,
  selectEvenlySpaced,
  validateIndexablePageHtml,
  validateIndexableSkillHtml,
  validateSitemapLocations,
} from '../../../scripts/seo-health-check.mjs';

describe('SEO health check parsing', () => {
  it('parses sitemap indexes and URL sets without losing escaped URLs', () => {
    expect(extractSitemapEntries(`
      <sitemapindex><sitemap><loc>https://skills.cat/sitemaps/core.xml</loc><lastmod>2026-07-18</lastmod></sitemap></sitemapindex>
    `)).toEqual([{
      loc: 'https://skills.cat/sitemaps/core.xml',
      lastmod: '2026-07-18',
    }]);
    expect(extractUrlEntries(`
      <urlset><url><loc>https://skills.cat/skills/acme/demo?a=1&amp;b=2</loc><lastmod>2026-07-18</lastmod></url></urlset>
    `)).toEqual([{
      loc: 'https://skills.cat/skills/acme/demo?a=1&b=2',
      lastmod: '2026-07-18',
    }]);
    expect(decodeXml('&lt;skill&gt;&apos;x&apos;&lt;/skill&gt;')).toBe("<skill>'x'</skill>");
  });

  it('checks freshness against a fixed audit time', () => {
    const now = Date.parse('2026-07-18T12:00:00.000Z');
    expect(isFreshSitemapDate('2026-07-18', 72, now)).toBe(true);
    expect(isFreshSitemapDate('2026-07-16', 72, now)).toBe(true);
    expect(isFreshSitemapDate('2026-07-10', 72, now)).toBe(false);
    expect(isFreshSitemapDate('not-a-date', 72, now)).toBe(false);
    expect(isFreshSitemapDate('', 72, now)).toBe(false);
  });

  it('selects a deterministic sample across the full sitemap range', () => {
    expect(selectEvenlySpaced(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'c', 'e']);
    expect(selectEvenlySpaced(['a', 'b'], 5)).toEqual(['a', 'b']);
    expect(selectEvenlySpaced(['a'], 0)).toEqual([]);
  });

  it('rejects duplicate, cross-origin, and oversized sitemap entry sets', () => {
    const options = {
      origin: 'https://skills.cat',
      label: 'test sitemap',
      maxEntries: 2,
      pathPrefix: '/skills/',
    };

    expect(() => validateSitemapLocations([
      { loc: 'https://skills.cat/skills/acme/one', lastmod: '2026-07-18' },
      { loc: 'https://skills.cat/skills/acme/two', lastmod: '2026-07-17' },
    ], options)).not.toThrow();
    expect(() => validateSitemapLocations([
      { loc: 'https://skills.cat/skills/acme/one', lastmod: '' },
      { loc: 'https://skills.cat/skills/acme/one', lastmod: '' },
    ], options)).toThrow(/duplicate URL/);
    expect(() => validateSitemapLocations([
      { loc: 'https://example.com/skills/acme/one', lastmod: '' },
    ], options)).toThrow(/cross-origin URL/);
    expect(() => validateSitemapLocations([
      { loc: 'https://skills.cat/skills/acme/one', lastmod: '' },
      { loc: 'https://skills.cat/skills/acme/two', lastmod: '' },
      { loc: 'https://skills.cat/skills/acme/three', lastmod: '' },
    ], options)).toThrow(/max is 2/);
  });

  it('validates canonical, robots, description, and structured data for skill HTML', () => {
    const url = 'https://skills.cat/skills/acme/demo';
    const html = `
      <html><head>
        <title>Demo - SkillsCat</title>
        <meta name="description" content="A useful skill">
        <meta name="robots" content="index, follow, max-image-preview:large">
        <link rel="canonical" href="${url}">
        <script type="application/ld+json">{"@type":"SoftwareSourceCode"}</script>
      </head></html>
    `;

    expect(() => validateIndexableSkillHtml(html, url)).not.toThrow();
    expect(() => validateIndexableSkillHtml(
      html.replace('index, follow, max-image-preview:large', 'noindex, follow'),
      url
    )).toThrow(/missing index robots directive/);
    expect(() => validateIndexableSkillHtml(html, `${url}-other`)).toThrow(/not self-referencing/);
    expect(() => validateIndexablePageHtml(
      html.replace('{"@type":"SoftwareSourceCode"}', '{}'),
      url
    )).not.toThrow();
  });
});
