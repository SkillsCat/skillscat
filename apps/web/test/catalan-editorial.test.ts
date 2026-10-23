import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalanArticles, getCatalanArticle } from '../src/lib/content/catalan-blog';
import { getDocsCopy } from '../src/lib/i18n/docs';
import { load as loadArticle } from '../src/routes/ca/blog/[slug]/+page';

describe('Catalan editorial resources', () => {
  it('provides three substantive articles with unique routes and heading anchors', () => {
    expect(catalanArticles).toHaveLength(3);
    expect(new Set(catalanArticles.map((article) => article.slug)).size).toBe(3);
    for (const article of catalanArticles) {
      expect(article.slug).toMatch(/^[a-z0-9-]+$/);
      expect(article.sections.length).toBeGreaterThanOrEqual(4);
      expect(new Set(article.sections.map((section) => section.id)).size).toBe(article.sections.length);
      expect(article.sections.flatMap((section) => section.paragraphs).join(' ').length).toBeGreaterThan(2000);
      expect(getCatalanArticle(article.slug)).toBe(article);
    }
  });

  it('does not substitute another article for an unknown slug', () => {
    expect(getCatalanArticle('article-inexistent')).toBeUndefined();
    expect(getCatalanArticle('constructor')).toBeUndefined();
  });

  it('loads the requested article and returns a real 404 for an unknown route', async () => {
    const article = catalanArticles[0];
    expect(await loadArticle({ params: { slug: article.slug } } as never)).toEqual({ article });
    expect(() => loadArticle({ params: { slug: 'article-inexistent' } } as never)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('keeps published installation examples slug-first, and repository installs inspection-only', () => {
    const commands = catalanArticles.flatMap((article) => article.sections.map((section) => section.code ?? '')).join('\n');
    expect(commands).toContain('npx skillscat add owner/my-skill');
    expect(commands).not.toMatch(/npx skillscat add owner\/repo(?! --list)/);
    expect(commands).not.toContain('--yes');
    expect(commands).not.toContain('--force');
  });

  it('provides localized docs copy and all three shared docs branches', () => {
    expect(getDocsCopy('ca').common.docsBreadcrumb).toBe('Documentació');
    const docs = readFileSync(new URL('../src/lib/components/docs/CatalanDocs.svelte', import.meta.url), 'utf8');
    expect(docs).not.toContain('Instal·el');
    for (const path of ['docs', 'docs/cli', 'docs/openclaw']) {
      const source = readFileSync(new URL(`../src/routes/${path}/+page.svelte`, import.meta.url), 'utf8');
      expect(source).toContain("i18n.locale() === 'ca'");
      expect(source).toContain('<CatalanDocs kind=');
    }
  });

  it('makes review limits and real contribution paths visible on the community page', () => {
    const source = readFileSync(new URL('../src/routes/ca/catala/+page.svelte', import.meta.url), 'utf8');
    expect(source).toContain('Pendent de revisió');
    expect(source).toContain('https://github.com/skillscat/skillscat/issues');
    expect(source).toContain('missatges del programa de terminal');
    expect(source).toContain('ni implica col·laboracions');
    for (const article of catalanArticles) {
      const combined = source + readFileSync(new URL('../src/lib/components/docs/CatalanDocs.svelte', import.meta.url), 'utf8');
      if (article.slug !== 'localitzar-un-flux-de-treball') expect(combined).toContain(`/ca/blog/${article.slug}`);
    }
  });
});
