import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getSkillBySlug } from '$lib/server/db/business/detail';
import { getLightweightRecommendedSkills, getRecommendedSkills } from '$lib/server/db/business/recommend';
import { loadSkillReadmeFromR2 } from '$lib/server/db/business/readme';
import { getCached } from '$lib/server/cache';
import { renderHighlightedReadmeMarkdown } from '$lib/server/text/highlight';
import { getOrRenderHighlightedReadme } from '$lib/server/skill/highlighted-readme';
import { setPublicPageCache } from '$lib/server/cache/page';
import { buildSkillSeoPayload } from '$lib/seo/skill-seo';
import { normalizeRecommendAlgoVersion } from '$lib/server/ranking/recommend-precompute';
import {
  readCachedRecommendSkills,
  RECOMMEND_ONLINE_CACHE_TTL_SECONDS,
  readRecommendRefreshState,
  shouldRefreshPrecomputedRecommend,
} from '$lib/server/ranking/recommend-cache';
import {
  buildOnlineRecommendCacheKey,
  getRealtimeRecommendMode,
  shouldLoadRecommendSignals,
} from '$lib/server/ranking/recommend-runtime';
import { buildSkillPathFromOwnerAndName, buildSkillSlug, encodeSkillSlugForPath, normalizeSkillName, normalizeSkillOwner } from '$lib/skill-path';
import type { SkillCardData, SkillDetail } from '$lib/types';
import { buildSkillInstallData } from '$lib/skill-install';
import { isSeoIndexableSkill } from '$lib/seo/indexability';

const PUBLIC_SKILL_HTML_CACHE_HEADER = 'X-Skillscat-Public-Skill-Cache';
// Keyed by skill ID + readme version, so entries are immutable after a skill update.
const README_HTML_CACHE_TTL = 60 * 60 * 24 * 30;

type SkillPageErrorKind = 'not_found' | 'temporary_failure';

function hasNonEmptyRecommendSkills(recommendSkills: SkillCardData[] | null | undefined): recommendSkills is SkillCardData[] {
  return Array.isArray(recommendSkills) && recommendSkills.length > 0;
}

/**
 * Multi-segment skill detail page: /skills/[owner]/[...name]
 *
 * This route handles URLs like:
 * - /skills/testowner/testrepo
 * - /skills/testowner/testrepo/sub-skill
 *
 * with unified slug format: owner/name...
 */
export const load: PageServerLoad = async ({ params, platform, locals, request, fetch, setHeaders, isDataRequest }) => {
  const perfStart = performance.now();
  const serverTimings: Array<{ name: string; dur: number; desc?: string }> = [];
  let serverTimingFlushed = false;

  const pushTiming = (name: string, start: number, desc?: string) => {
    serverTimings.push({
      name,
      dur: Math.max(0, performance.now() - start),
      desc,
    });
  };

  const timed = async <T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      pushTiming(name, start, desc);
    }
  };

  const flushServerTiming = () => {
    if (serverTimingFlushed) return;
    serverTimingFlushed = true;
    serverTimings.push({
      name: 'total',
      dur: Math.max(0, performance.now() - perfStart),
      desc: isDataRequest ? 'data' : 'html',
    });
    setHeaders({
      'Server-Timing': serverTimings
        .map((entry) => {
          const dur = Number(entry.dur.toFixed(1));
          const descPart = entry.desc ? `;desc="${entry.desc.replace(/"/g, '')}"` : '';
          return `${entry.name};dur=${dur}${descPart}`;
        })
        .join(', '),
    });
  };

  const finish = <T>(value: T): T => {
    flushServerTiming();
    return value;
  };

  const createNotFoundResult = () => ({
      skill: null,
    recommendSkills: [] as SkillCardData[],
    error: 'Skill not found or you do not have permission to view it.',
    errorKind: 'not_found' as SkillPageErrorKind,
  });

  const createTemporaryFailureResult = () => ({
    skill: null,
    recommendSkills: [] as SkillCardData[],
    error: 'Failed to load skill',
    errorKind: 'temporary_failure' as SkillPageErrorKind,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    KV: platform?.env?.KV,
  };
  const recommendAlgoVersion = normalizeRecommendAlgoVersion(
    (platform?.env as { RECOMMEND_ALGO_VERSION?: string } | undefined)?.RECOMMEND_ALGO_VERSION
  );

  const userId = locals.user?.id || null;
  const readPrincipal = locals.authPrincipal?.scopes.includes('read')
    ? {
        userId: locals.authPrincipal.userId,
        orgId: locals.authPrincipal.orgId,
      }
    : null;

  const normalizedOwner = normalizeSkillOwner(params.owner);
  const normalizedName = normalizeSkillName(params.name);
  if (!normalizedOwner) {
    setHeaders({
      'X-Skillscat-Status-Override': '404',
      'Cache-Control': 'no-store',
    });
    return finish(createNotFoundResult());
  }

  if (!normalizedName) {
    setHeaders({
      'X-Skillscat-Status-Override': '404',
      'Cache-Control': 'no-store',
    });
    return finish(createNotFoundResult());
  }

  if (normalizedOwner !== params.owner || normalizedName !== params.name) {
    throw redirect(308, buildSkillPathFromOwnerAndName(normalizedOwner, normalizedName));
  }

  const slug = buildSkillSlug(normalizedOwner, normalizedName);

  try {
    const skill = await timed(
      'skill_detail',
      () => getSkillBySlug(
        env,
        slug,
        readPrincipal,
        (name, dur, desc) => {
          serverTimings.push({ name, dur, desc });
        },
        Boolean(isDataRequest)
      ),
      'db+r2'
    );

    if (!skill) {
      setHeaders({
        'X-Skillscat-Status-Override': '404',
      });
      return finish(createNotFoundResult());
    }

    const shouldDeferUserState = skill.visibility === 'public';
    const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

    // Start the readme and bookmark work immediately: neither depends on the
    // recommend cache read below, so they should overlap with it instead of
    // waiting for one extra R2 round trip before they can begin.
    const renderedReadmePromise = timed(
      'readme_html',
      async (): Promise<string> => {
        const loadRawReadme = async () => skill.readme ?? await loadSkillReadmeFromR2(env, skill);

        if (skill.visibility !== 'public') {
          // Private skills never touch shared caches; highlight per request.
          const rawReadme = await loadRawReadme();
          return rawReadme ? renderHighlightedReadmeMarkdown(rawReadme) : '';
        }

        // Version-keyed (updatedAt/indexedAt) so entries are immutable after a
        // skill update: colo-local Cache API in front of the R2 derived object.
        const readmeVersion = skill.updatedAt ?? skill.indexedAt ?? 0;
        const { data } = await getCached(
          `readme:html:hl:${skill.id}:${readmeVersion}`,
          () => getOrRenderHighlightedReadme({
            r2: env.R2,
            skillId: skill.id,
            readmeVersion,
            waitUntil,
            render: async () => {
              const rawReadme = await loadRawReadme();
              return rawReadme ? renderHighlightedReadmeMarkdown(rawReadme) : '';
            },
          }),
          README_HTML_CACHE_TTL,
          { waitUntil }
        );
        return data;
      },
      'secondary'
    );

    const isBookmarkedPromise = shouldDeferUserState
      ? Promise.resolve(false)
      : timed(
        'bookmark',
        async () => {
          if (!userId || !env.DB) return false;
          const bookmark = await env.DB.prepare(
            'SELECT 1 FROM favorites WHERE user_id = ? AND skill_id = ?'
          ).bind(userId, skill.id).first();
          return !!bookmark;
        },
        'secondary'
      );

    const cachedRecommendSkillsResult = skill.visibility === 'public'
      ? await timed(
        'recommend_cached',
        async () => {
          try {
            return await readCachedRecommendSkills({
              skillId: skill.id,
              r2: env.R2,
              algoVersion: recommendAlgoVersion,
              waitUntil,
              limit: 10,
            });
          } catch (cachedRecommendError) {
            console.warn('Failed to read cached recommend skills:', cachedRecommendError);
            return {
              recommendSkills: null,
              hit: false,
              algoVersion: recommendAlgoVersion,
            };
          }
        },
        'cache+r2'
      )
      : null;
    const cachedRecommendSkills = cachedRecommendSkillsResult?.recommendSkills ?? null;
    const usableCachedRecommendSkills = hasNonEmptyRecommendSkills(cachedRecommendSkills)
      ? cachedRecommendSkills
      : null;
    const encodedSlug = skill.visibility === 'public'
      ? encodeSkillSlugForPath(skill.slug)
      : null;

    if (skill.visibility === 'public' && cachedRecommendSkills !== null && waitUntil && encodedSlug) {
      serverTimings.push({ name: 'recommend_state', dur: 0, desc: 'deferred' });
      waitUntil(
        (async () => {
          const recommendRefreshState = await readRecommendRefreshState(env.DB, skill.id);

          if (
            hasNonEmptyRecommendSkills(cachedRecommendSkills)
            && !shouldRefreshPrecomputedRecommend(recommendRefreshState, recommendAlgoVersion)
          ) {
            return;
          }

          await fetch(`/api/skills/${encodedSlug}/recommend`, {
            headers: { accept: 'application/json' },
          });
        })()
          .catch((recommendRefreshError) => {
            console.warn('Failed background refresh trigger for recommend skills:', recommendRefreshError);
          })
      );
    }

    setPublicPageCache({
      setHeaders,
      request,
      isAuthenticated: shouldDeferUserState ? false : Boolean(readPrincipal),
      sMaxAge: 300,
      staleWhileRevalidate: 1800,
      varyByLanguageHeader: false,
      varyByCookie: !shouldDeferUserState,
    });

    if (shouldDeferUserState) {
      setHeaders({ [PUBLIC_SKILL_HTML_CACHE_HEADER]: '1' });
    }

    // Recommendations always resolve server-side so they are part of the SSR
    // HTML (unique content + internal links for crawlers). On a precomputed
    // cache miss we fall back to the realtime query inline instead of
    // deferring to a client-side fetch of /api/skills/<slug>/recommend.
    const recommendSkillsPromise = timed(
      'recommend',
      async () => {
        if (usableCachedRecommendSkills !== null) {
          return usableCachedRecommendSkills;
        }

        const realtimeRecommendMode = getRealtimeRecommendMode(skill.visibility, skill.tier, false);
        if (realtimeRecommendMode === 'lightweight') {
          const { data } = await getCached(
            buildOnlineRecommendCacheKey(skill.id, realtimeRecommendMode),
            () => getLightweightRecommendedSkills(
              env,
              skill.id,
              skill.categories || [],
              skill.repoOwner || '',
              10,
              (name, dur, desc) => {
                serverTimings.push({ name, dur, desc });
              },
              false
            ),
            RECOMMEND_ONLINE_CACHE_TTL_SECONDS
          );
          return data;
        }

        const shouldUseRecommendSignals = shouldLoadRecommendSignals(realtimeRecommendMode);
        const { data } = await getCached(
          buildOnlineRecommendCacheKey(skill.id, realtimeRecommendMode),
          () => getRecommendedSkills(
            env,
            skill.id,
            shouldUseRecommendSignals ? (skill.categories || []) : [],
            skill.repoOwner || '',
            10,
            (name, dur, desc) => {
              serverTimings.push({ name, dur, desc });
            },
            false,
            shouldUseRecommendSignals ? null : []
          ),
          RECOMMEND_ONLINE_CACHE_TTL_SECONDS
        );
        return data;
      },
      'secondary'
    );

    const [recommendSkillsResult, renderedReadmeResult, isBookmarkedResult] = await Promise.allSettled([
      recommendSkillsPromise,
      renderedReadmePromise,
      isBookmarkedPromise,
    ]);

    const recommendSkills = recommendSkillsResult.status === 'fulfilled'
      ? recommendSkillsResult.value
      : (console.error('Failed to load recommend skills:', recommendSkillsResult.reason), []);

    const renderedReadme = renderedReadmeResult.status === 'fulfilled'
      ? renderedReadmeResult.value
      : (console.error('Failed to render/read cached SKILL.md HTML:', renderedReadmeResult.reason), '');

    const isBookmarked = isBookmarkedResult.status === 'fulfilled'
      ? isBookmarkedResult.value
      : (console.error('Failed to load bookmark state:', isBookmarkedResult.reason), false);

    // Determine if this is a dot-folder skill (e.g., .claude/SKILL.md)
    const isDotFolderSkill = skill.skillPath ? /^\.[\w-]+/.test(skill.skillPath) : false;
    const hasReadme = Boolean(skill.readme) || Boolean(renderedReadme);
    // Avoid sending both raw markdown and rendered HTML in the same data payload.
    const skillForClient: SkillDetail = hasReadme ? { ...skill, readme: null } : skill;
    const install = buildSkillInstallData(skillForClient);
    const seo = buildSkillSeoPayload(skill);

    return finish({
      skill: skillForClient,
      install,
      renderedReadme,
      recommendSkills,
      isBookmarked: shouldDeferUserState ? false : isBookmarked,
      isAuthenticated: shouldDeferUserState ? false : Boolean(readPrincipal),
      deferUserState: shouldDeferUserState,
      trackPublicAccessClientSide: shouldDeferUserState,
      isDotFolderSkill,
      hasReadme,
      seo,
      seoIndexable: isSeoIndexableSkill(skill),
    });
  } catch (error) {
    console.error('Error loading skill:', error);
    setHeaders({
      'X-Skillscat-Status-Override': '500',
      'Cache-Control': 'no-store',
    });
    return finish(createTemporaryFailureResult());
  }
};
