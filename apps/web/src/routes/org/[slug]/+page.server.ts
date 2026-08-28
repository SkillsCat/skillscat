import type { PageServerLoad } from './$types';
import {
  resolveOrgPagePayload,
  type OrgPageErrorKind,
  type OrgPageMember,
  type OrgPageOrg,
  type OrgPageSkill,
} from '$lib/server/org/page';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, platform, setHeaders, locals }) => {
  // The page embeds a mutable public skill list. Keep the server-side snapshot
  // cache, but never let a generic edge cache outlive a visibility mutation.
  // Note: setHeaders throws when Cache-Control is set twice, so this must be
  // the only place this load sets it.
  setHeaders({
    'Cache-Control': 'no-store',
    'CDN-Cache-Control': 'no-store',
    Vary: 'Cookie',
  });

  const slug = params.slug;
  if (slug && slug !== slug.toLowerCase()) {
    throw redirect(308, `/org/${encodeURIComponent(slug.toLowerCase())}`);
  }
  const fallback = {
    slug,
    org: null as OrgPageOrg | null,
    members: [] as OrgPageMember[],
    skills: [] as OrgPageSkill[],
    error: 'Failed to load organization',
    errorKind: 'temporary_failure' as OrgPageErrorKind,
  };

  try {
    // Resolve the payload in-process instead of issuing an internal HTTP
    // subrequest to /api/orgs/[slug]/page. The API route calls the same
    // resolver, so the page and the API share one code path.
    const resolved = await resolveOrgPagePayload(
      {
        db: platform?.env?.DB,
        locals,
        waitUntil: platform?.context?.waitUntil?.bind(platform.context),
      },
      slug
    );

    if (resolved.status !== 200) {
      if (resolved.status === 404) {
        setHeaders({ 'X-Skillscat-Status-Override': '404' });
      } else {
        setHeaders({
          'X-Skillscat-Status-Override': '500',
          'Cache-Control': 'no-store',
        });
      }
    }

    const data = resolved.data;
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
