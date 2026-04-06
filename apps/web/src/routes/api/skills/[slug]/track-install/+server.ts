import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveSkillSourceInfo } from '$lib/server/skill/source';
import {
  buildSkillMetricMessage,
  enqueueSkillMetric,
} from '$lib/server/skill/metrics';

/**
 * POST /api/skills/[slug]/track-install - Track CLI installations
 */
export const POST: RequestHandler = async ({ params, platform, request, locals }) => {
  const slug = params.slug?.trim();
  if (!slug) {
    throw error(400, 'Skill slug is required');
  }

  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const resolved = await resolveSkillSourceInfo(
    {
      db: platform?.env?.DB,
      request,
      locals,
      waitUntil,
    },
    slug
  );

  if (!resolved.skill) {
    if (resolved.status === 401 || resolved.status === 403) {
      throw error(404, 'Skill not found');
    }
    throw error(resolved.status, resolved.error || 'Skill not found');
  }
  const skill = resolved.skill;

  const occurredAt = Date.now();
  if (!enqueueSkillMetric(
    platform?.env?.METRICS_QUEUE,
    buildSkillMetricMessage('install', skill.id, { occurredAt }),
    {
      waitUntil,
      onError: () => platform?.env?.DB?.prepare(`
        INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
        VALUES (?, NULL, ?, 'install', ?)
      `)
        .bind(crypto.randomUUID(), skill.id, occurredAt)
        .run()
        .catch(() => {
          // non-critical telemetry
        }),
    }
  )) {
    try {
      await platform?.env?.DB?.prepare(`
        INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
        VALUES (?, NULL, ?, 'install', ?)
      `)
        .bind(crypto.randomUUID(), skill.id, occurredAt)
        .run();
    } catch {
      // non-critical telemetry
    }
  }

  return json({ success: true }, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Cache': resolved.cacheStatus,
    },
  });
};
