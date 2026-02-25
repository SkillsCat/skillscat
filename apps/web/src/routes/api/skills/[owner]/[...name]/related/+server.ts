import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ApiResponse, SkillCardData } from '$lib/types';
import { getCached } from '$lib/server/cache';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { checkSkillAccess } from '$lib/server/permissions';
import { getRelatedSkills } from '$lib/server/db/utils';
import { buildSkillSlug, normalizeSkillName, normalizeSkillOwner } from '$lib/skill-path';

const RELATED_RESPONSE_LIMIT = 6;
const RELATED_CACHE_LIMIT = 10;
const RELATED_CACHE_TTL = 3600;

interface SkillContextRow {
  id: string;
  repoOwner: string | null;
  visibility: 'public' | 'private' | 'unlisted' | null;
  categoriesJson: string | null;
}

function hasStatus(errorValue: unknown): errorValue is { status: number } {
  return typeof errorValue === 'object' && errorValue !== null && 'status' in errorValue;
}

export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const perfStart = performance.now();
  const serverTimings: Array<{ name: string; dur: number; desc?: string }> = [];
  const pushTiming = (name: string, start: number, desc?: string) => {
    serverTimings.push({ name, dur: Math.max(0, performance.now() - start), desc });
  };
  const timed = async <T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      pushTiming(name, start, desc);
    }
  };
  const buildServerTimingHeader = () => {
    const entries = [
      ...serverTimings,
      { name: 'total', dur: Math.max(0, performance.now() - perfStart), desc: 'related api' }
    ];
    return entries
      .map((entry) => {
        const dur = Number(entry.dur.toFixed(1));
        const descPart = entry.desc ? `;desc="${entry.desc.replace(/"/g, '')}"` : '';
        return `${entry.name};dur=${dur}${descPart}`;
      })
      .join(', ');
  };

  const owner = normalizeSkillOwner(params.owner);
  const name = normalizeSkillName(params.name);
  if (!owner || !name) {
    throw error(400, 'Invalid skill identifier');
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({
      success: false,
      error: 'Database not available',
    } satisfies ApiResponse<never>, { status: 503 });
  }

  const slug = buildSkillSlug(owner, name);

  try {
    const skill = await timed(
      'ctx_skill',
      () => db.prepare(`
      SELECT
        s.id,
        s.repo_owner as repoOwner,
        s.visibility,
        (
          SELECT json_group_array(sc.category_slug)
          FROM skill_categories sc
          WHERE sc.skill_id = s.id
        ) as categoriesJson
      FROM skills s
      WHERE s.slug = ?
      LIMIT 1
    `)
      .bind(slug)
      .first<SkillContextRow>(),
      'skill context + categories'
    );

    if (!skill) {
      return json({
        success: false,
        error: 'Skill not found',
      } satisfies ApiResponse<never>, { status: 404 });
    }

    if (skill.visibility === 'private') {
      const auth = await getAuthContext(request, locals, db);
      if (!auth.userId) {
        return json({
          success: false,
          error: 'Authentication required',
        } satisfies ApiResponse<never>, { status: 401 });
      }
      requireScope(auth, 'read');
      const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
      if (!hasAccess) {
        return json({
          success: false,
          error: 'You do not have permission to access this skill',
        } satisfies ApiResponse<never>, { status: 403 });
      }
    }

    let categories: string[] = [];
    if (skill.categoriesJson) {
      try {
        const parsed = JSON.parse(skill.categoriesJson) as unknown;
        if (Array.isArray(parsed)) {
          categories = parsed.filter((value): value is string => typeof value === 'string');
        }
      } catch {
        categories = [];
      }
    }

    const { data: relatedSkills, hit } = await timed(
      'related_cached',
      () => getCached(
      `related:${skill.id}`,
      () => getRelatedSkills(
        { DB: db },
        skill.id,
        categories,
        skill.repoOwner || '',
        RELATED_CACHE_LIMIT,
        (name, dur, desc) => {
          serverTimings.push({ name, dur, desc });
        },
        false
      ),
      RELATED_CACHE_TTL
    ),
      'cache wrapper'
    );

    return json({
        success: true,
        data: {
        relatedSkills: relatedSkills.slice(0, RELATED_RESPONSE_LIMIT),
      },
    } satisfies ApiResponse<{ relatedSkills: SkillCardData[] }>, {
      headers: {
        'Cache-Control': skill.visibility === 'private'
          ? 'private, max-age=30, stale-while-revalidate=60'
          : 'public, max-age=300, stale-while-revalidate=3600',
        'X-Cache': hit ? 'HIT' : 'MISS',
        'Server-Timing': buildServerTimingHeader(),
      },
    });
  } catch (err) {
    console.error('Error fetching related skills:', err);
    if (hasStatus(err)) throw err;
    return json({
      success: false,
      error: 'Failed to fetch related skills',
    } satisfies ApiResponse<never>, {
      status: 500,
      headers: {
        'Server-Timing': buildServerTimingHeader(),
      }
    });
  }
};
