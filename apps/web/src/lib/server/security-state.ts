import type { D1Database, Queue } from '@cloudflare/workers-types';

import {
  SECURITY_REPORT_FATAL_THRESHOLD,
  getSecurityReportRiskLevel,
  shouldRequestPremiumByReports,
  type SecurityAnalysisTier,
} from './security';

export type SecurityAnalysisTrigger =
  | 'content_update'
  | 'report'
  | 'trending_head'
  | 'manual';

export interface SecurityAnalysisMessage {
  type: 'analyze_security';
  skillId: string;
  trigger: SecurityAnalysisTrigger;
  requestedTier?: SecurityAnalysisTier | 'auto';
}

export interface SkillSecurityReportSummary {
  openSecurityReportCount: number;
  reportRiskLevel: ReturnType<typeof getSecurityReportRiskLevel>;
  shouldRequestPremium: boolean;
}

const SECURITY_REPORT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_SECURITY_ANALYSIS_LEASE_MS = 15 * 60 * 1000;
const CONTENT_FINGERPRINT_CHANGED_SQL = `
  skill_security_state.content_fingerprint IS NULL
  OR skill_security_state.content_fingerprint != excluded.content_fingerprint
`;
const SECURITY_ANALYSIS_REQUIRED_SQL = `
  ${CONTENT_FINGERPRINT_CHANGED_SQL}
  OR (
    skill_security_state.current_free_scan_id IS NULL
    AND skill_security_state.current_premium_scan_id IS NULL
  )
`;

export async function markSkillSecurityDirty(
  db: D1Database | undefined,
  params: {
    skillId: string;
    contentFingerprint: string;
    now?: number;
  }
): Promise<void> {
  if (!db) return;

  const now = params.now ?? Date.now();
  await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      content_fingerprint,
      dirty,
      next_update_at,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, 1, ?, 'pending', ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      content_fingerprint = excluded.content_fingerprint,
      dirty = CASE
        WHEN ${SECURITY_ANALYSIS_REQUIRED_SQL} THEN 1
        ELSE 0
      END,
      next_update_at = CASE
        WHEN ${SECURITY_ANALYSIS_REQUIRED_SQL} THEN excluded.next_update_at
        ELSE skill_security_state.next_update_at
      END,
      status = CASE
        WHEN ${SECURITY_ANALYSIS_REQUIRED_SQL} THEN 'pending'
        ELSE skill_security_state.status
      END,
      current_total_score = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.current_total_score
      END,
      current_risk_level = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.current_risk_level
      END,
      current_free_scan_id = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.current_free_scan_id
      END,
      current_premium_scan_id = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.current_premium_scan_id
      END,
      premium_due_reason = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.premium_due_reason
      END,
      premium_requested_at = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.premium_requested_at
      END,
      premium_requested_fingerprint = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.premium_requested_fingerprint
      END,
      premium_last_analyzed_fingerprint = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.premium_last_analyzed_fingerprint
      END,
      vt_eligibility = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN 'unknown'
        ELSE skill_security_state.vt_eligibility
      END,
      vt_priority = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN 0
        ELSE skill_security_state.vt_priority
      END,
      vt_status = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN 'pending'
        ELSE skill_security_state.vt_status
      END,
      vt_bundle_sha256 = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_bundle_sha256
      END,
      vt_bundle_size = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_bundle_size
      END,
      vt_analysis_id = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_analysis_id
      END,
      vt_last_stats = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_last_stats
      END,
      vt_next_attempt_at = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_next_attempt_at
      END,
      vt_last_attempt_at = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_last_attempt_at
      END,
      vt_last_submitted_at = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_last_submitted_at
      END,
      vt_last_completed_at = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.vt_last_completed_at
      END,
      fail_count = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN 0
        ELSE skill_security_state.fail_count
      END,
      last_error = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.last_error
      END,
      last_error_at = CASE
        WHEN ${CONTENT_FINGERPRINT_CHANGED_SQL} THEN NULL
        ELSE skill_security_state.last_error_at
      END,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, params.contentFingerprint, now, now, now)
    .run();
}

export async function markSkillSecurityPremiumDue(
  db: D1Database | undefined,
  params: {
    skillId: string;
    contentFingerprint: string;
    reason: string;
    now?: number;
  }
): Promise<void> {
  if (!db) return;

  const now = params.now ?? Date.now();
  await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      content_fingerprint,
      dirty,
      next_update_at,
      status,
      premium_due_reason,
      premium_requested_at,
      premium_requested_fingerprint,
      created_at,
      updated_at
    )
    VALUES (?, ?, 1, ?, 'pending', ?, ?, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      dirty = 1,
      next_update_at = excluded.next_update_at,
      status = 'pending',
      premium_due_reason = excluded.premium_due_reason,
      premium_requested_at = excluded.premium_requested_at,
      premium_requested_fingerprint = excluded.premium_requested_fingerprint,
      updated_at = excluded.updated_at
  `)
    .bind(params.skillId, params.contentFingerprint, now, params.reason, now, params.contentFingerprint, now, now)
    .run();
}

export async function tryClaimSkillSecurityAnalysis(
  db: D1Database | undefined,
  params: {
    skillId: string;
    contentFingerprint: string;
    now?: number;
    leaseMs?: number;
  }
): Promise<boolean> {
  if (!db) return false;

  const now = params.now ?? Date.now();
  const leaseUntil = now + (params.leaseMs ?? DEFAULT_SECURITY_ANALYSIS_LEASE_MS);
  const result = await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      content_fingerprint,
      dirty,
      next_update_at,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, 1, ?, 'running', ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      content_fingerprint = excluded.content_fingerprint,
      dirty = 1,
      next_update_at = excluded.next_update_at,
      status = excluded.status,
      updated_at = excluded.updated_at
    WHERE skill_security_state.status != 'running'
      OR skill_security_state.next_update_at IS NULL
      OR skill_security_state.next_update_at <= ?
  `)
    .bind(params.skillId, params.contentFingerprint, leaseUntil, now, now, now)
    .run();

  return Number(result.meta?.changes || 0) > 0;
}

export async function refreshSkillSecurityReportSummary(
  db: D1Database | undefined,
  skillId: string,
  now: number = Date.now()
): Promise<SkillSecurityReportSummary> {
  if (!db) {
    return {
      openSecurityReportCount: 0,
      reportRiskLevel: 'low',
      shouldRequestPremium: false,
    };
  }

  const since = now - SECURITY_REPORT_LOOKBACK_MS;
  const summary = await db.prepare(`
    SELECT
      COUNT(DISTINCT sr.reporter_user_id) AS openSecurityReportCount,
      COALESCE(MAX(s.stars), 0) AS stars,
      ss.content_fingerprint AS contentFingerprint,
      ss.premium_last_analyzed_fingerprint AS premiumLastAnalyzedFingerprint
    FROM skills s
    LEFT JOIN skill_security_state ss ON ss.skill_id = s.id
    LEFT JOIN skill_reports sr
      ON sr.skill_id = s.id
      AND sr.reason = 'security'
      AND sr.status = 'open'
      AND sr.created_at >= ?
    WHERE s.id = ?
    GROUP BY s.id
  `)
    .bind(since, skillId)
    .first<{
      openSecurityReportCount: number | null;
      stars: number | null;
      contentFingerprint: string | null;
      premiumLastAnalyzedFingerprint: string | null;
    }>();

  const openSecurityReportCount = Number(summary?.openSecurityReportCount || 0);
  const reportRiskLevel = getSecurityReportRiskLevel(openSecurityReportCount);
  const stars = Number(summary?.stars || 0);
  const contentFingerprint = summary?.contentFingerprint || null;
  const premiumLastAnalyzedFingerprint = summary?.premiumLastAnalyzedFingerprint || null;
  const shouldRequestPremium = shouldRequestPremiumByReports(stars, openSecurityReportCount)
    && Boolean(contentFingerprint)
    && premiumLastAnalyzedFingerprint !== contentFingerprint;

  await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      open_security_report_count,
      report_risk_level,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      open_security_report_count = excluded.open_security_report_count,
      report_risk_level = excluded.report_risk_level,
      updated_at = excluded.updated_at
  `)
    .bind(skillId, openSecurityReportCount, reportRiskLevel, now, now)
    .run();

  if (shouldRequestPremium && contentFingerprint) {
    await markSkillSecurityPremiumDue(db, {
      skillId,
      contentFingerprint,
      reason: 'report_threshold',
      now,
    });
  }

  return {
    openSecurityReportCount,
    reportRiskLevel,
    shouldRequestPremium,
  };
}

export async function queueSecurityAnalysis(
  queue: Queue<SecurityAnalysisMessage> | undefined,
  message: SecurityAnalysisMessage
): Promise<void> {
  if (!queue) return;
  await queue.send(message);
}

export function buildSecurityAnalysisMessage(
  skillId: string,
  trigger: SecurityAnalysisTrigger,
  requestedTier: SecurityAnalysisMessage['requestedTier'] = 'auto'
): SecurityAnalysisMessage {
  return {
    type: 'analyze_security',
    skillId,
    trigger,
    requestedTier,
  };
}

export function shouldEscalateSecurityReports(count: number, stars: number): boolean {
  return stars > 100 && count >= SECURITY_REPORT_FATAL_THRESHOLD;
}
