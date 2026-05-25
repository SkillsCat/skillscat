import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { CATEGORIES } from '$lib/constants';
import type { SkillCardData } from '$lib/types';
import {
  resolveRegistrySearch,
  type RegistrySkillItem,
} from '$lib/server/registry/search';
import { setPublicPageCache } from '$lib/server/cache/page';

const ITEMS_PER_PAGE = 50;

interface PaginationData {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  baseUrl: string;
}

function parsePage(raw: string | null): number {
  const parsed = Number.parseInt(raw || '1', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function buildSearchBaseUrl(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

function toSkillCardData(skill: RegistrySkillItem): SkillCardData {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    description: skill.description || null,
    repoOwner: skill.owner,
    repoName: skill.repo,
    stars: skill.stars,
    forks: 0,
    trendingScore: 0,
    updatedAt: skill.updatedAt,
    authorAvatar: skill.authorAvatar,
    categories: skill.categories,
  };
}

export const load: PageServerLoad = async ({
  url,
  platform,
  setHeaders,
  locals,
  request,
}) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: 60,
    staleWhileRevalidate: 300,
  });

  const query = url.searchParams.get('q')?.trim() ?? '';
  const page = parsePage(url.searchParams.get('page'));

  if (!query) {
    if (page > 1) {
      throw redirect(302, '/search');
    }

    return {
      query: '',
      skills: [],
      matchedCategories: [],
      pagination: null,
    };
  }

  const lowerQuery = query.toLowerCase();
  const matchedCategories = CATEGORIES.filter(
    (category) =>
      category.name.toLowerCase().includes(lowerQuery) ||
      category.description.toLowerCase().includes(lowerQuery) ||
      category.keywords.some((keyword) => keyword.includes(lowerQuery))
  );

  const resolved = await resolveRegistrySearch(
    {
      db: platform?.env?.DB,
      request,
      locals,
      waitUntil: platform?.context?.waitUntil?.bind(platform.context),
    },
    {
      query,
      category: '',
      limit: ITEMS_PER_PAGE,
      offset: (page - 1) * ITEMS_PER_PAGE,
      includePrivate: false,
    }
  );

  const totalItems = resolved.data.total;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));

  if (page > totalPages) {
    const baseUrl = buildSearchBaseUrl(query);
    throw redirect(302, totalPages === 1 ? baseUrl : `${baseUrl}&page=${totalPages}`);
  }

  const pagination: PaginationData = {
    currentPage: page,
    totalPages,
    totalItems,
    itemsPerPage: ITEMS_PER_PAGE,
    baseUrl: buildSearchBaseUrl(query),
  };

  return {
    query,
    skills: resolved.data.skills.map(toSkillCardData),
    matchedCategories,
    pagination,
  };
};
