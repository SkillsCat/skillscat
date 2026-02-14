import type { PageServerLoad } from './$types';
import { setPublicPageCache } from '$lib/server/page-cache';

interface Org {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  description: string;
  avatarUrl: string;
  verified: boolean;
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
}

export const load: PageServerLoad = async ({ params, fetch, setHeaders, locals, request, cookies }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 120,
    staleWhileRevalidate: 600,
  });

  const slug = params.slug;
  const fallback = {
    slug,
    org: null as Org | null,
    members: [] as Member[],
    skills: [] as Skill[],
    error: 'Failed to load organization',
  };

  try {
    const [orgRes, membersRes, skillsRes] = await Promise.all([
      fetch(`/api/orgs/${slug}`),
      fetch(`/api/orgs/${slug}/members`),
      fetch(`/api/orgs/${slug}/skills`),
    ]);

    if (!orgRes.ok) {
      return {
        ...fallback,
        error: orgRes.status === 404 ? 'Organization not found' : 'Failed to load organization',
      };
    }

    const orgData = await orgRes.json() as { organization?: Org };
    if (!orgData.organization) {
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

    return {
      slug,
      org: orgData.organization,
      members,
      skills,
      error: null,
    };
  } catch {
    return fallback;
  }
};
