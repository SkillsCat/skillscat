import type { RequestHandler } from './$types';
import { CATEGORIES } from '$lib/constants/categories';
import { getCachedText } from '$lib/server/cache';
import { encodeSkillSlugForPath } from '$lib/skill-path';

const SITE_URL = 'https://skills.cat';
const MAX_SKILL_PAGES = 50000;
const MAX_PROFILE_PAGES = 5000;
const MAX_ORG_PAGES = 2000;

type ChangeFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

interface SitemapPage {
  url: string;
  priority: string;
  changefreq: ChangeFrequency;
  lastmod?: string;
}

function toIsoDate(timestamp: unknown): string | undefined {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return new Date(numeric).toISOString().split('T')[0];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dedupePages(pages: SitemapPage[]): SitemapPage[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.url)) {
      return false;
    }
    seen.add(page.url);
    return true;
  });
}

export const GET: RequestHandler = async ({ platform }) => {
  const db = platform?.env?.DB;

  const { data: xml, hit } = await getCachedText(
    'sitemap:xml',
    async () => {
      // Static pages
      const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'daily' },
        { url: '/trending', priority: '0.9', changefreq: 'hourly' },
        { url: '/recent', priority: '0.9', changefreq: 'hourly' },
        { url: '/top', priority: '0.9', changefreq: 'daily' },
        { url: '/categories', priority: '0.8', changefreq: 'weekly' },
        { url: '/privacy', priority: '0.3', changefreq: 'monthly' },
        { url: '/terms', priority: '0.3', changefreq: 'monthly' },
      ] satisfies SitemapPage[];

      // Category pages
      const categoryPages = CATEGORIES.map((cat) => ({
        url: `/category/${cat.slug}`,
        priority: '0.7',
        changefreq: 'daily',
      })) satisfies SitemapPage[];

      // Skill pages from database
      let skillPages: SitemapPage[] = [];
      let profilePages: SitemapPage[] = [];
      let orgPages: SitemapPage[] = [];

      if (db) {
        try {
          const skills = await db.prepare(`
            SELECT slug, updated_at, indexed_at, last_commit_at
            FROM skills
            WHERE visibility = 'public'
            ORDER BY COALESCE(last_commit_at, updated_at, indexed_at) DESC
            LIMIT ?
          `)
            .bind(MAX_SKILL_PAGES)
            .all<{
              slug: string;
              updated_at: number | null;
              indexed_at: number | null;
              last_commit_at: number | null;
            }>();

          skillPages = (skills.results || []).map((skill) => ({
            url: `/skills/${encodeSkillSlugForPath(skill.slug)}`,
            priority: '0.6',
            changefreq: 'weekly',
            lastmod: toIsoDate(skill.last_commit_at ?? skill.updated_at ?? skill.indexed_at),
          }));

          const profiles = await db.prepare(`
            SELECT username, updated_at
            FROM authors
            WHERE username IS NOT NULL AND skills_count > 0
            ORDER BY updated_at DESC
            LIMIT ?
          `)
            .bind(MAX_PROFILE_PAGES)
            .all<{ username: string; updated_at: number | null }>();

          profilePages = (profiles.results || []).map((profile) => ({
            url: `/u/${encodeURIComponent(profile.username)}`,
            priority: '0.5',
            changefreq: 'weekly',
            lastmod: toIsoDate(profile.updated_at),
          }));

          const orgs = await db.prepare(`
            SELECT o.slug, o.updated_at
            FROM organizations o
            WHERE EXISTS (
              SELECT 1
              FROM skills s
              WHERE s.org_id = o.id AND s.visibility = 'public'
            )
            ORDER BY o.updated_at DESC
            LIMIT ?
          `)
            .bind(MAX_ORG_PAGES)
            .all<{ slug: string; updated_at: number | null }>();

          orgPages = (orgs.results || []).map((org) => ({
            url: `/org/${encodeURIComponent(org.slug)}`,
            priority: '0.55',
            changefreq: 'daily',
            lastmod: toIsoDate(org.updated_at),
          }));
        } catch (error) {
          console.error('Error fetching skills for sitemap:', error);
        }
      }

      // Generate XML
      const allPages = dedupePages([
        ...staticPages,
        ...categoryPages,
        ...skillPages,
        ...profilePages,
        ...orgPages,
      ]);

      return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
  .map(
    (page) => `  <url>
    <loc>${escapeXml(`${SITE_URL}${page.url}`)}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>${page.lastmod ? `\n    <lastmod>${page.lastmod}</lastmod>` : ''}
  </url>`
  )
  .join('\n')}
</urlset>`;
    },
    3600
  );

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
      'X-Cache': hit ? 'HIT' : 'MISS',
    },
  });
};
