import type { PageServerLoad } from './$types';
import { getSkillBySlug, getRelatedSkills, recordSkillAccess } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { renderReadmeMarkdown } from '$lib/server/markdown';
import { setPublicPageCache } from '$lib/server/page-cache';

const BOT_UA_PATTERN = /\b(bot|crawler|spider|slurp|preview|headless|lighthouse)\b/i;

function shouldTrackAccess(request: Request): boolean {
  const purpose = `${request.headers.get('purpose') || ''} ${request.headers.get('sec-purpose') || ''}`.toLowerCase();
  if (purpose.includes('prefetch')) {
    return false;
  }

  const ua = (request.headers.get('user-agent') || '').trim();
  if (!ua) {
    return false;
  }

  return !BOT_UA_PATTERN.test(ua);
}

function getAccessClientKey(request: Request, userId: string | null): string | undefined {
  if (userId) {
    return `user:${userId}`;
  }

  const ua = (request.headers.get('user-agent') || '').slice(0, 64);
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return ua ? `ipua:${cfIp}:${ua}` : `ip:${cfIp}`;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return ua ? `ipua:${first}:${ua}` : `ip:${first}`;
    }
  }

  return ua ? `ua:${ua}` : undefined;
}

/**
 * Two-segment skill detail page: /skills/[owner]/[name]
 *
 * This route handles clean URLs like /skills/testowner/testrepo
 * using unified slug format: owner/name
 */
export const load: PageServerLoad = async ({ params, platform, locals, request, setHeaders, cookies }) => {
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
    KV: platform?.env?.KV,
  };

  const userId = locals.user?.id || null;

  const slug = `${params.owner}/${params.name}`;

  try {
    const skill = await getSkillBySlug(env, slug, userId);

    if (!skill) {
      return {
        skill: null,
        relatedSkills: [],
        error: 'Skill not found or you do not have permission to view it.',
      };
    }

    // Record access asynchronously (don't block response)
    if (skill.visibility === 'public' && shouldTrackAccess(request)) {
      recordSkillAccess(env, skill.id, getAccessClientKey(request, userId)).catch((err) => {
        console.error('Failed to record skill access:', err);
      });
    }

    // Get related skills based on categories (multi-signal scoring, cached 1h)
    const { data: relatedSkills } = await getCached(
      `related:${skill.id}`,
      () => getRelatedSkills(env, skill.id, skill.categories || [], skill.repoOwner || '', 10),
      3600
    );

    let renderedReadme = '';
    if (skill.readme) {
      if (skill.visibility === 'public') {
        const readmeVersion = skill.updatedAt ?? skill.indexedAt ?? 0;
        const { data } = await getCached(
          `readme:html:${skill.id}:${readmeVersion}`,
          () => Promise.resolve(renderReadmeMarkdown(skill.readme)),
          3600
        );
        renderedReadme = data;
      } else {
        renderedReadme = renderReadmeMarkdown(skill.readme);
      }
    }

    // Check if user has bookmarked this skill
    let isBookmarked = false;
    if (userId && env.DB) {
      const bookmark = await env.DB.prepare(
        'SELECT 1 FROM favorites WHERE user_id = ? AND skill_id = ?'
      ).bind(userId, skill.id).first();
      isBookmarked = !!bookmark;
    }

    return {
      skill,
      renderedReadme,
      relatedSkills,
      isOwner: skill.ownerId === userId,
      isBookmarked,
      isAuthenticated: !!userId,
    };
  } catch (error) {
    console.error('Error loading skill:', error);
    return {
      skill: null,
      relatedSkills: [],
      error: 'Failed to load skill',
    };
  }
};
