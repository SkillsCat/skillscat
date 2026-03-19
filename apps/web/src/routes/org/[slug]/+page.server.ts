import type { PageServerLoad } from './$types';
import { setPublicPageCache } from '$lib/server/cache/page';

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

type OrgPageErrorKind = 'not_found' | 'temporary_failure';

export const load: PageServerLoad = async ({ params, fetch, setHeaders, locals, request, platform }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: 120,
    staleWhileRevalidate: 600,
    varyByLanguageHeader: false,
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
    errorKind: 'temporary_failure' as OrgPageErrorKind,
  };

  if (useAnonDataCache && cache) {
    try {
      const cached = await cache.match(new Request(`https://cache/${cacheKey}`));
      if (cached) {
        const data = await cached.json() as Partial<typeof fallback> & {
          errorKind?: OrgPageErrorKind | null;
        };
        const inferredErrorKind = data.errorKind
          ?? (
            data.error === 'Organization not found'
              ? 'not_found'
              : (data.error ? 'temporary_failure' : null)
          );

        if (inferredErrorKind === 'not_found') {
          setHeaders({ 'X-Skillscat-Status-Override': '404' });
          return {
            slug,
            org: data.org ?? null,
            members: data.members ?? [],
            skills: data.skills ?? [],
            error: data.error ?? 'Organization not found',
            errorKind: 'not_found' as OrgPageErrorKind,
          };
        }

        if (inferredErrorKind === 'temporary_failure') {
          setHeaders({
            'X-Skillscat-Status-Override': '500',
            'Cache-Control': 'no-store',
          });
        }

        return {
          slug,
          org: data.org ?? null,
          members: data.members ?? [],
          skills: data.skills ?? [],
          error: data.error ?? null,
          errorKind: inferredErrorKind,
        };
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
      } else {
        setHeaders({
          'X-Skillscat-Status-Override': '500',
          'Cache-Control': 'no-store',
        });
      }
      const result = {
        ...fallback,
        error: orgRes.status === 404 ? 'Organization not found' : 'Failed to load organization',
        errorKind: orgRes.status === 404 ? 'not_found' as OrgPageErrorKind : 'temporary_failure' as OrgPageErrorKind,
      };
      if (orgRes.status === 404 && useAnonDataCache && cache) {
        const response = new Response(JSON.stringify(result), {
          headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_NOT_FOUND}` },
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
        errorKind: 'not_found',
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
      errorKind: null,
    };
    if (useAnonDataCache && cache) {
      const response = new Response(JSON.stringify(result), {
        headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
      });
      platform?.context?.waitUntil(cache.put(new Request(`https://cache/${cacheKey}`), response));
    }
    return result;
  } catch {
    setHeaders({
      'X-Skillscat-Status-Override': '500',
      'Cache-Control': 'no-store',
    });
    return fallback;
  }
};
