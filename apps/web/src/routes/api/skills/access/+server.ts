import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordSkillAccess } from '$lib/server/db/business/access';
import {
  shouldRecordSkillAccess,
  getSkillAccessClientKey,
  shouldTrackSkillAccess,
} from '$lib/server/skill/access';
import {
  buildSkillAccessDedupeKey,
  buildSkillMetricMessage,
  enqueueSkillMetric,
} from '$lib/server/skill/metrics';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

async function recordPublicSkillAccessFallback(input: {
  db: D1Database | undefined;
  kv: KVNamespace | undefined;
  workerSecret?: string;
  skillId: string;
  clientKey?: string;
}): Promise<void> {
  if (!input.db) {
    return;
  }

  const skill = await input.db.prepare(`
    SELECT visibility
    FROM skills
    WHERE id = ?
    LIMIT 1
  `)
    .bind(input.skillId)
    .first<{ visibility: 'public' | 'private' | 'unlisted' | null }>();

  if (!skill || skill.visibility !== 'public') {
    return;
  }

  await recordSkillAccess(
    {
      DB: input.db,
      KV: input.kv,
      WORKER_SECRET: input.workerSecret,
    },
    input.skillId,
    input.clientKey,
    { skipClientDedupe: true }
  );
}

export const POST: RequestHandler = async ({ locals, platform, request }) => {
  const body = await request.json() as { skillId?: string };
  const skillId = body.skillId?.trim();
  if (!skillId) {
    throw error(400, 'skillId is required');
  }

  if (!shouldTrackSkillAccess(request)) {
    return json({ success: true, skipped: true }, { headers: NO_STORE_HEADERS });
  }

  const now = Date.now();
  const session = await locals.auth?.();
  const clientKey = getSkillAccessClientKey(request, session?.user?.id ?? null);

  if (!shouldRecordSkillAccess(skillId, clientKey, now)) {
    return json({ success: true, skipped: true }, { headers: NO_STORE_HEADERS });
  }

  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  if (enqueueSkillMetric(
    platform?.env?.METRICS_QUEUE,
    buildSkillMetricMessage('access', skillId, {
      occurredAt: now,
      dedupeKey: clientKey ? buildSkillAccessDedupeKey(skillId, clientKey, now) : undefined,
    }),
    {
      waitUntil,
      onError: () => recordPublicSkillAccessFallback({
        db: platform?.env?.DB,
        kv: platform?.env?.KV,
        workerSecret: platform?.env?.WORKER_SECRET,
        skillId,
        clientKey,
      }),
    }
  )) {
    return json({ success: true }, { headers: NO_STORE_HEADERS });
  }

  await recordPublicSkillAccessFallback({
    db: platform?.env?.DB,
    kv: platform?.env?.KV,
    workerSecret: platform?.env?.WORKER_SECRET,
    skillId,
    clientKey,
  });

  return json({ success: true }, { headers: NO_STORE_HEADERS });
};
