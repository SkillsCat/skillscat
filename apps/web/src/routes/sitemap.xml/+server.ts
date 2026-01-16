import type { RequestHandler } from './$types';
import { CATEGORIES } from '$lib/constants/categories';

const SITE_URL = 'https://skillscat.dev';

export const GET: RequestHandler = async ({ platform }) => {
  const db = platform?.env?.DB;

  // Static pages
  const staticPages = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
    { url: '/trending', priority: '0.9', changefreq: 'hourly' },
    { url: '/recent', priority: '0.9', changefreq: 'hourly' },
    { url: '/top', priority: '0.9', changefreq: 'daily' },
    { url: '/categories', priority: '0.8', changefreq: 'weekly' },
    { url: '/search', priority: '0.7', changefreq: 'weekly' },
    { url: '/privacy', priority: '0.3', changefreq: 'monthly' },
    { url: '/terms', priority: '0.3', changefreq: 'monthly' },
  ];

  // Category pages
  const categoryPages = CATEGORIES.map((cat) => ({
    url: `/category/${cat.slug}`,
    priority: '0.7',
    changefreq: 'daily',
  }));

  // Skill pages from database
  let skillPages: { url: string; priority: string; changefreq: string; lastmod?: string }[] = [];

  if (db) {
    try {
      const skills = await db.prepare(`
        SELECT slug, updated_at FROM skills ORDER BY trending_score DESC LIMIT 1000
      `).all();

      skillPages = skills.results.map((skill: any) => ({
        url: `/skills/${skill.slug}`,
        priority: '0.6',
        changefreq: 'weekly',
        lastmod: new Date(skill.updated_at).toISOString().split('T')[0],
      }));
    } catch (error) {
      console.error('Error fetching skills for sitemap:', error);
    }
  }

  // Generate XML
  const allPages: { url: string; priority: string; changefreq: string; lastmod?: string }[] = [...staticPages, ...categoryPages, ...skillPages];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
  .map(
    (page) => `  <url>
    <loc>${SITE_URL}${page.url}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>${page.lastmod ? `\n    <lastmod>${page.lastmod}</lastmod>` : ''}
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    },
  });
};
