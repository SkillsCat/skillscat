import type { PageServerLoad } from './$types';
import { setPublicPageCache } from '$lib/server/cache/page';

interface Org {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
  verified: boolean;
  createdAt?: number;
  updatedAt?: number;
  memberCount: number;
  skillCount: number;
  userRole: string | null;
}

interface Member {
  userId: string;
  name: string | null;
  image: string | null;
  role: string;
}

interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'public' | 'private' | 'unlisted';
  stars: number;
  updatedAt?: number;
}

type OrgPageErrorKind = 'not_found' | 'temporary_failure';

export const load: PageServerLoad = async ({ params, fetch, setHeaders, locals, request }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    sMaxAge: 120,
    staleWhileRevalidate: 600,
    varyByLanguageHeader: false,
  });

  const slug = params.slug;
  const fallback = {
    slug,
    org: null as Org | null,
    members: [] as Member[],
    skills: [] as Skill[],
    error: 'Failed to load organization',
    errorKind: 'temporary_failure' as OrgPageErrorKind,
  };

  try {
    const response = await fetch(`/api/orgs/${slug}/page`);
    let data = fallback;

    try {
      data = await response.json() as typeof fallback;
    } catch {
      data = {
        ...fallback,
        error: response.status === 404 ? 'Organization not found' : fallback.error,
        errorKind: response.status === 404 ? 'not_found' : fallback.errorKind,
      };
    }

    if (!response.ok) {
      if (response.status === 404) {
        setHeaders({ 'X-Skillscat-Status-Override': '404' });
      } else {
        setHeaders({
          'X-Skillscat-Status-Override': '500',
          'Cache-Control': 'no-store',
        });
      }
    }

    return {
      slug,
      org: data.org ?? null,
      members: data.members ?? [],
      skills: data.skills ?? [],
      error: data.error ?? null,
      errorKind: data.errorKind ?? null,
    };
  } catch {
    setHeaders({
      'X-Skillscat-Status-Override': '500',
      'Cache-Control': 'no-store',
    });
    return fallback;
  }
};
