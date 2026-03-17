import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { D1Database } from '@cloudflare/workers-types';

import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { checkSkillAccess } from '$lib/server/auth/permissions';
import { normalizeSkillSlug } from '$lib/skill-path';
import {
  buildSecurityAnalysisMessage,
  queueSecurityAnalysis,
  refreshSkillSecurityReportSummary,
} from '$lib/server/security/state';
import type { SecurityReportReason } from '$lib/server/security';

const MAX_DETAILS_LENGTH = 2_000;

interface SkillRow {
  id: string;
  stars: number;
  visibility: string;
}

function parseReason(value: unknown): SecurityReportReason {
  if (value === 'security' || value === 'copyright') {
    return value;
  }
  throw error(400, 'Invalid report reason');
}

function toOptionalDetails(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw error(400, 'details must be a string');
  }

  const normalized = value.trim();
  if (normalized.length > MAX_DETAILS_LENGTH) {
    throw error(400, `details must be at most ${MAX_DETAILS_LENGTH} characters`);
  }

  return normalized || null;
}

async function upsertOpenReport(
  db: D1Database,
  params: {
    skillId: string;
    reporterUserId: string;
    reason: SecurityReportReason;
    details: string | null;
    source: string;
    now: number;
  }
): Promise<void> {
  const reportId = crypto.randomUUID();
  const inserted = await db.prepare(`
    INSERT OR IGNORE INTO skill_reports (
      id,
      skill_id,
      reporter_user_id,
      reason,
      details,
      source,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `)
    .bind(
      reportId,
      params.skillId,
      params.reporterUserId,
      params.reason,
      params.details,
      params.source,
      params.now,
      params.now,
    )
    .run();

  if (Number(inserted.meta?.changes || 0) === 0) {
    const existing = await db.prepare(`
      SELECT id
      FROM skill_reports
      WHERE skill_id = ?
        AND reporter_user_id = ?
        AND reason = ?
        AND status = 'open'
      LIMIT 1
    `)
      .bind(params.skillId, params.reporterUserId, params.reason)
      .first<{ id: string }>();

    if (!existing?.id) {
      throw error(409, 'Unable to resolve existing open report');
    }

    await db.prepare(`
      UPDATE skill_reports
      SET details = ?,
          source = ?,
          updated_at = ?
      WHERE id = ?
    `)
      .bind(
        params.details,
        params.source,
        params.now,
        existing.id,
      )
      .run();
  }
}

export const POST: RequestHandler = async ({ params, platform, locals, request }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(503, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }

  const slug = normalizeSkillSlug(params.slug || '');
  if (!slug) {
    throw error(400, 'Invalid skill slug');
  }

  let payload: { reason?: unknown; details?: unknown };
  try {
    payload = await request.json() as { reason?: unknown; details?: unknown };
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const reason = parseReason(payload.reason);
  const details = toOptionalDetails(payload.details);

  const skill = await db.prepare(`
    SELECT id, stars, visibility
    FROM skills
    WHERE slug = ?
    LIMIT 1
  `)
    .bind(slug)
    .first<SkillRow>();

  if (!skill) {
    throw error(404, 'Skill not found');
  }

  if (skill.visibility === 'private') {
    requireScope(auth, 'read');
    const hasAccess = await checkSkillAccess(skill.id, auth.userId, db);
    if (!hasAccess) {
      throw error(403, 'You do not have permission to access this skill');
    }
  }

  const now = Date.now();
  const source = request.headers.get('user-agent')?.toLowerCase().includes('skillscat-cli')
    ? 'cli'
    : 'api';
  await upsertOpenReport(db, {
    skillId: skill.id,
    reporterUserId: auth.userId,
    reason,
    details,
    source,
    now,
  });

  if (reason === 'copyright') {
    return json({
      success: true,
      reason,
      message: 'Copyright report recorded',
    });
  }

  const summary = await refreshSkillSecurityReportSummary(db, skill.id, now);

  try {
    await queueSecurityAnalysis(
      platform?.env?.SECURITY_ANALYSIS_QUEUE,
      buildSecurityAnalysisMessage(
        skill.id,
        'report',
        summary.shouldRequestPremium ? 'premium' : 'free'
      )
    );
  } catch (queueError) {
    console.error(`Failed to queue security report analysis for ${skill.id}:`, queueError);
  }

  return json({
    success: true,
    reason,
    message: 'Security report recorded',
    report: {
      openSecurityReportCount: summary.openSecurityReportCount,
      riskLevel: summary.reportRiskLevel,
      premiumEscalated: summary.shouldRequestPremium,
    },
  });
};
