import type { PageServerLoad } from './$types';
import { setPublicPageCache } from '$lib/server/page-cache';

const CACHE_TTL = 300;
const CACHE_TTL_NOT_FOUND = 60;

interface Org {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  description: string;
  avatarUrl: string;
  verified: boolean;
  createdAt?: number;
  updatedAt?: number;
  memberCount: number;
  skillCount: number;
  userRole: string | null;
}

interface Member {
  userId: string;
  name: string;
  image: string;
  role: string;
}

interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  visibility: 'public' | 'private' | 'unlisted';
  stars: number;
  updatedAt?: number;
}

export const load: PageServerLoad = async ({ params, fetch, setHeaders, locals, request, cookies, platform }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 120,
    staleWhileRevalidate: 600,
  });

  const slug = params.slug;
  const cache = platform?.caches?.default;
  const useAnonDataCache = !locals.user;
  const cacheKey = `org-page:${slug}`;
  const fallback = {
    slug,
    org: null as Org | null,
    members: [] as Member[],
    skills: [] as Skill[],
    error: 'Failed to load organization',
  };

  if (useAnonDataCache && cache) {
    try {
      const cached = await cache.match(new Request(`https://cache/${cacheKey}`));
      if (cached) {
        const data = await cached.json() as typeof fallback;
        if (data?.error === 'Organization not found') {
          setHeaders({ 'X-Skillscat-Status-Override': '404' });
        }
        return data;
      }
    } catch {
      // Cache miss or unavailable cache API
    }
  }

  try {
    const [orgRes, membersRes, skillsRes] = await Promise.all([
      fetch(`/api/orgs/${slug}`),
      fetch(`/api/orgs/${slug}/members`),
      fetch(`/api/orgs/${slug}/skills`),
    ]);

    if (!orgRes.ok) {
      if (orgRes.status === 404) {
        setHeaders({ 'X-Skillscat-Status-Override': '404' });
      }
      const result = {
        ...fallback,
        error: orgRes.status === 404 ? 'Organization not found' : 'Failed to load organization',
      };
      if (useAnonDataCache && cache) {
        const ttl = orgRes.status === 404 ? CACHE_TTL_NOT_FOUND : CACHE_TTL;
        const response = new Response(JSON.stringify(result), {
          headers: { 'Cache-Control': `public, max-age=${ttl}` },
        });
        platform?.context?.waitUntil(cache.put(new Request(`https://cache/${cacheKey}`), response));
      }
      return result;
    }

    const orgData = await orgRes.json() as { organization?: Org };
    if (!orgData.organization) {
      setHeaders({ 'X-Skillscat-Status-Override': '404' });
      return {
        ...fallback,
        error: 'Organization not found',
      };
    }

    let members: Member[] = [];
    if (membersRes.ok) {
      const membersData = await membersRes.json() as { members?: Member[] };
      members = membersData.members || [];
    }

    let skills: Skill[] = [];
    if (skillsRes.ok) {
      const skillsData = await skillsRes.json() as { skills?: Skill[] };
      skills = skillsData.skills || [];
    }

    const result = {
      slug,
      org: orgData.organization,
      members,
      skills,
      error: null,
    };
    if (useAnonDataCache && cache) {
      const response = new Response(JSON.stringify(result), {
        headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
      });
      platform?.context?.waitUntil(cache.put(new Request(`https://cache/${cacheKey}`), response));
    }
    return result;
  } catch {
    return fallback;
  }
};
