import type { PageServerLoad } from './$types';
import { getCategoryBySlug, type Category } from '$lib/constants/categories';
import { getSkillsByCategoryPaginated } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { setPublicPageCache } from '$lib/server/page-cache';

const ITEMS_PER_PAGE = 24;

interface DynamicCategory {
  slug: string;
  name: string;
  description: string | null;
  type: string;
}

export const load: PageServerLoad = async ({ params, url, platform, setHeaders, locals, request, cookies }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 120,
    staleWhileRevalidate: 600,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
  };
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { data } = await getCached(
    `page:category:v1:${params.slug}:${page}`,
    async () => {
      let category: Category | null = getCategoryBySlug(params.slug) || null;
      let isDynamic = false;

      if (!category && env.DB) {
        try {
          const dbCategory = await env.DB.prepare(`
            SELECT slug, name, description, type
            FROM categories
            WHERE slug = ?
          `).bind(params.slug).first<DynamicCategory>();

          if (dbCategory) {
            category = {
              slug: dbCategory.slug,
              name: dbCategory.name,
              description: dbCategory.description || 'AI-suggested category',
              keywords: []
            };
            isDynamic = true;
          }
        } catch {
          // Database not available or query failed
        }
      }

      if (!category) {
        setHeaders({ 'X-Skillscat-Status-Override': '404' });
        return {
          category: null,
          skills: [],
          pagination: null,
          isDynamic: false,
        };
      }

      const { skills, total } = await getSkillsByCategoryPaginated(env, params.slug, page, ITEMS_PER_PAGE);
      const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

      return {
        category,
        skills,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: ITEMS_PER_PAGE,
          baseUrl: `/category/${params.slug}`,
        },
        isDynamic,
      };
    },
    120
  );

  if (!data.category) {
    setHeaders({ 'X-Skillscat-Status-Override': '404' });
  }

  return data;
};
