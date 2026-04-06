import type { ScheduledController, ExecutionContext, VirusTotalEnv } from './shared/types';
import type { D1Database } from '@cloudflare/workers-types';
import { createLogger } from './shared/utils';
import {
  buildSkillBundleFiles,
  buildStoredZip,
  sha256Hex,
  type SecuritySkillRow,
} from './shared/security';
import {
  normalizeVirusTotalStats,
} from '../src/lib/server/security';

const log = createLogger('VirusTotal');
const VT_API_BASE = 'https://www.virustotal.com/api/v3';
const DEFAULT_DAILY_REQUEST_BUDGET = 300;
const DEFAULT_MINUTE_REQUEST_BUDGET = 4;
const DEFAULT_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_VT_CLAIM_LEASE_MS = 10 * 60 * 1000;

interface PendingVirusTotalRow extends SecuritySkillRow {
  skill_id: string;
  vt_status: string;
  vt_priority: number;
  vt_analysis_id: string | null;
  vt_bundle_sha256: string | null;
  vt_next_attempt_at: number | null;
  open_security_report_count: number | null;
}

function hasBytes<T extends { bytes?: Uint8Array }>(file: T): file is T & { bytes: Uint8Array } {
  return Boolean(file.bytes);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function formatMinuteKey(now: Date): string {
  return now.toISOString().slice(0, 16);
}

async function getBudgetCount(kv: KVNamespace, key: string): Promise<number> {
  const value = await kv.get(key);
  const parsed = Number.parseInt(value || '0', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function incrementBudget(kv: KVNamespace, key: string, value: number, ttlSeconds: number): Promise<void> {
  await kv.put(key, String(value), { expirationTtl: ttlSeconds });
}

export async function tryConsumeBudget(env: VirusTotalEnv, amount: number = 1): Promise<boolean> {
  const now = new Date();
  const dayKey = `vt:budget:day:${formatDayKey(now)}`;
  const minuteKey = `vt:budget:minute:${formatMinuteKey(now)}`;
  const dailyLimit = parsePositiveInt(env.VT_DAILY_REQUEST_BUDGET, DEFAULT_DAILY_REQUEST_BUDGET);
  const minuteLimit = parsePositiveInt(env.VT_MINUTE_REQUEST_BUDGET, DEFAULT_MINUTE_REQUEST_BUDGET);

  const [dayCount, minuteCount] = await Promise.all([
    getBudgetCount(env.KV, dayKey),
    getBudgetCount(env.KV, minuteKey),
  ]);

  if (dayCount + amount > dailyLimit || minuteCount + amount > minuteLimit) {
    return false;
  }

  await Promise.all([
    incrementBudget(env.KV, dayKey, dayCount + amount, 2 * 24 * 60 * 60),
    incrementBudget(env.KV, minuteKey, minuteCount + amount, 5 * 60),
  ]);
  return true;
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    'x-apikey': apiKey,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function parseRetryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 15 * 60 * 1000;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const parsed = Date.parse(header);
  if (Number.isFinite(parsed)) {
    return Math.max(15_000, parsed - Date.now());
  }
  return 15 * 60 * 1000;
}

async function updateVirusTotalState(
  db: D1Database,
  params: {
    skillId: string;
    status: string;
    bundleSha256?: string | null;
    bundleSize?: number | null;
    analysisId?: string | null;
    stats?: string | null;
    nextAttemptAt?: number | null;
    lastAttemptAt?: number | null;
    lastSubmittedAt?: number | null;
    lastCompletedAt?: number | null;
    eligibility?: string;
    errorMessage?: string | null;
  }
): Promise<void> {
  const now = Date.now();
  await db.prepare(`
    UPDATE skill_security_state
    SET vt_status = ?,
        vt_bundle_sha256 = COALESCE(?, vt_bundle_sha256),
        vt_bundle_size = COALESCE(?, vt_bundle_size),
        vt_analysis_id = ?,
        vt_last_stats = ?,
        vt_next_attempt_at = ?,
        vt_last_attempt_at = ?,
        vt_last_submitted_at = ?,
        vt_last_completed_at = ?,
        vt_eligibility = COALESCE(?, vt_eligibility),
        last_error = ?,
        last_error_at = CASE WHEN ? IS NULL THEN last_error_at ELSE ? END,
        updated_at = ?
    WHERE skill_id = ?
  `)
    .bind(
      params.status,
      params.bundleSha256 ?? null,
      params.bundleSize ?? null,
      params.analysisId ?? null,
      params.stats ?? null,
      params.nextAttemptAt ?? null,
      params.lastAttemptAt ?? now,
      params.lastSubmittedAt ?? null,
      params.lastCompletedAt ?? null,
      params.eligibility ?? null,
      params.errorMessage ?? null,
      params.errorMessage ?? null,
      params.errorMessage ? now : null,
      now,
      params.skillId,
    )
    .run();
}

async function loadPendingSkills(db: D1Database, now: number): Promise<PendingVirusTotalRow[]> {
  const result = await db.prepare(`
    SELECT
      ss.skill_id,
      ss.vt_status,
      ss.vt_priority,
      ss.vt_analysis_id,
      ss.vt_bundle_sha256,
      ss.vt_next_attempt_at,
      ss.open_security_report_count,
      s.id,
      s.slug,
      s.repo_owner,
      s.repo_name,
      s.skill_path,
      s.readme,
      s.visibility,
      s.source_type,
      s.stars,
      s.trending_score,
      s.tier,
      s.file_structure,
      s.updated_at
    FROM skill_security_state ss
    INNER JOIN skills s ON s.id = ss.skill_id
    WHERE ss.vt_eligibility = 'eligible'
      AND ss.vt_status IN ('pending_lookup', 'pending_upload', 'pending_analysis_poll')
      AND (ss.vt_next_attempt_at IS NULL OR ss.vt_next_attempt_at <= ?)
    ORDER BY ss.vt_priority DESC,
             ss.open_security_report_count DESC,
             s.stars DESC,
             ss.updated_at ASC
    LIMIT 10
  `)
    .bind(now)
    .all<PendingVirusTotalRow>();

  return result.results || [];
}

export async function tryClaimVirusTotalWork(
  db: D1Database,
  params: {
    skillId: string;
    status: string;
    now?: number;
    leaseMs?: number;
  }
): Promise<boolean> {
  const now = params.now ?? Date.now();
  const leaseUntil = now + (params.leaseMs ?? DEFAULT_VT_CLAIM_LEASE_MS);
  const result = await db.prepare(`
    UPDATE skill_security_state
    SET vt_next_attempt_at = ?,
        updated_at = ?
    WHERE skill_id = ?
      AND vt_eligibility = 'eligible'
      AND vt_status = ?
      AND (vt_next_attempt_at IS NULL OR vt_next_attempt_at <= ?)
  `)
    .bind(leaseUntil, now, params.skillId, params.status, now)
    .run();

  return Number(result.meta?.changes || 0) > 0;
}

async function fetchFileReport(apiKey: string, sha256: string): Promise<Response> {
  return fetch(`${VT_API_BASE}/files/${sha256}`, {
    headers: buildHeaders(apiKey),
  });
}

async function fetchAnalysis(apiKey: string, analysisId: string): Promise<Response> {
  return fetch(`${VT_API_BASE}/analyses/${analysisId}`, {
    headers: buildHeaders(apiKey),
  });
}

async function uploadBundle(apiKey: string, fileName: string, zipBytes: Uint8Array): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([toArrayBuffer(zipBytes)], { type: 'application/zip' }), fileName);
  return fetch(`${VT_API_BASE}/files`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: form,
  });
}

function extractAnalysisId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as {
    data?: {
      id?: string;
    };
  };
  return data.data?.id || null;
}

function extractFileStats(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as {
    data?: {
      attributes?: {
        last_analysis_stats?: Record<string, number>;
      };
    };
  };
  const stats = normalizeVirusTotalStats(data.data?.attributes?.last_analysis_stats || null);
  return JSON.stringify(stats || {});
}

function extractAnalysisStatus(payload: unknown): { status: string | null; sha256: string | null } {
  if (!payload || typeof payload !== 'object') return { status: null, sha256: null };
  const data = payload as {
    data?: {
      attributes?: {
        status?: string;
      };
      meta?: {
        file_info?: {
          sha256?: string;
        };
      };
    };
    meta?: {
      file_info?: {
        sha256?: string;
      };
    };
  };

  return {
    status: data.data?.attributes?.status || null,
    sha256: data.data?.meta?.file_info?.sha256 || data.meta?.file_info?.sha256 || null,
  };
}

async function processPendingSkill(
  row: PendingVirusTotalRow,
  env: VirusTotalEnv
): Promise<void> {
  const apiKey = env.VIRUSTOTAL_API_KEY;
  if (!apiKey) {
    return;
  }

  const now = Date.now();
  const skill: SecuritySkillRow = {
    id: row.id,
    slug: row.slug,
    repo_owner: row.repo_owner,
    repo_name: row.repo_name,
    skill_path: row.skill_path,
    readme: row.readme,
    visibility: row.visibility,
    source_type: row.source_type,
    stars: row.stars,
    trending_score: row.trending_score,
    tier: row.tier,
    file_structure: row.file_structure,
    updated_at: row.updated_at,
  };

  let bundleSha256 = row.vt_bundle_sha256;
  let bundleBytes: Uint8Array | null = null;
  let bundleSize = 0;

  if (!bundleSha256 || row.vt_status === 'pending_lookup' || row.vt_status === 'pending_upload') {
    const bundleFiles = await buildSkillBundleFiles(skill, env);
    if (bundleFiles.length === 0) {
      await updateVirusTotalState(env.DB, {
        skillId: row.skill_id,
        status: 'skipped',
        eligibility: 'skipped_bundle_empty',
        errorMessage: null,
      });
      return;
    }

    bundleBytes = buildStoredZip(
      bundleFiles
        .filter(hasBytes)
        .map((file) => ({ path: file.path, bytes: file.bytes }))
    );
    bundleSize = bundleBytes.byteLength;
    if (bundleSize > parsePositiveInt(env.VT_UPLOAD_MAX_BYTES, DEFAULT_UPLOAD_MAX_BYTES)) {
      await updateVirusTotalState(env.DB, {
        skillId: row.skill_id,
        status: 'skipped',
        eligibility: 'skipped_size_limit',
        bundleSize,
      });
      return;
    }

    bundleSha256 = await sha256Hex(bundleBytes);
  }

  if (row.vt_status === 'pending_analysis_poll' && row.vt_analysis_id) {
    if (!await tryConsumeBudget(env, 1)) {
      return;
    }

    const analysisResponse = await fetchAnalysis(apiKey, row.vt_analysis_id);
    if (analysisResponse.status === 429) {
      await updateVirusTotalState(env.DB, {
        skillId: row.skill_id,
        status: 'pending_analysis_poll',
        nextAttemptAt: now + parseRetryAfterMs(analysisResponse),
        errorMessage: 'VirusTotal rate limited analysis polling',
      });
      return;
    }

    if (!analysisResponse.ok) {
      await updateVirusTotalState(env.DB, {
        skillId: row.skill_id,
        status: 'pending_analysis_poll',
        nextAttemptAt: now + 15 * 60 * 1000,
        errorMessage: `VirusTotal analysis polling failed: ${analysisResponse.status}`,
      });
      return;
    }

    const analysisPayload = await analysisResponse.json();
    const analysisState = extractAnalysisStatus(analysisPayload);
    bundleSha256 = analysisState.sha256 || bundleSha256;

    if (analysisState.status !== 'completed') {
      await updateVirusTotalState(env.DB, {
        skillId: row.skill_id,
        status: 'pending_analysis_poll',
        analysisId: row.vt_analysis_id,
        bundleSha256,
        nextAttemptAt: now + 5 * 60 * 1000,
        lastAttemptAt: now,
        errorMessage: null,
      });
      return;
    }
  }

  if (!bundleSha256) {
    await updateVirusTotalState(env.DB, {
      skillId: row.skill_id,
      status: 'pending_lookup',
      nextAttemptAt: now + 10 * 60 * 1000,
      errorMessage: 'Missing VT bundle sha256',
    });
    return;
  }

  if (!await tryConsumeBudget(env, 1)) {
    return;
  }

  const reportResponse = await fetchFileReport(apiKey, bundleSha256);
  if (reportResponse.status === 200) {
    const reportPayload = await reportResponse.json();
    const stats = extractFileStats(reportPayload);
    await updateVirusTotalState(env.DB, {
      skillId: row.skill_id,
      status: 'completed',
      bundleSha256,
      bundleSize,
      stats,
      nextAttemptAt: null,
      lastAttemptAt: now,
      lastCompletedAt: now,
      errorMessage: null,
    });
    return;
  }

  if (reportResponse.status === 429) {
    await updateVirusTotalState(env.DB, {
      skillId: row.skill_id,
      status: row.vt_status,
      bundleSha256,
      bundleSize,
      nextAttemptAt: now + parseRetryAfterMs(reportResponse),
      lastAttemptAt: now,
      errorMessage: 'VirusTotal rate limited report lookup',
    });
    return;
  }

  if (reportResponse.status !== 404) {
    await updateVirusTotalState(env.DB, {
      skillId: row.skill_id,
      status: row.vt_status,
      bundleSha256,
      bundleSize,
      nextAttemptAt: now + 15 * 60 * 1000,
      lastAttemptAt: now,
      errorMessage: `VirusTotal report lookup failed: ${reportResponse.status}`,
    });
    return;
  }

  if (!bundleBytes) {
    const bundleFiles = await buildSkillBundleFiles(skill, env);
    bundleBytes = buildStoredZip(
      bundleFiles
        .filter(hasBytes)
        .map((file) => ({ path: file.path, bytes: file.bytes }))
    );
    bundleSize = bundleBytes.byteLength;
  }

  if (!await tryConsumeBudget(env, 1)) {
    await updateVirusTotalState(env.DB, {
      skillId: row.skill_id,
      status: 'pending_upload',
      bundleSha256,
      bundleSize,
      nextAttemptAt: now + 60 * 1000,
      lastAttemptAt: now,
      errorMessage: null,
    });
    return;
  }

  const uploadResponse = await uploadBundle(apiKey, `${skill.slug.replace(/\//g, '-')}.zip`, bundleBytes);
  if (uploadResponse.status === 429) {
    await updateVirusTotalState(env.DB, {
      skillId: row.skill_id,
      status: 'pending_upload',
      bundleSha256,
      bundleSize,
      nextAttemptAt: now + parseRetryAfterMs(uploadResponse),
      lastAttemptAt: now,
      errorMessage: 'VirusTotal rate limited upload',
    });
    return;
  }

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    await updateVirusTotalState(env.DB, {
      skillId: row.skill_id,
      status: 'pending_upload',
      bundleSha256,
      bundleSize,
      nextAttemptAt: now + 15 * 60 * 1000,
      lastAttemptAt: now,
      errorMessage: `VirusTotal upload failed: ${uploadResponse.status} ${errorText.slice(0, 200)}`,
    });
    return;
  }

  const uploadPayload = await uploadResponse.json();
  const analysisId = extractAnalysisId(uploadPayload);
  await updateVirusTotalState(env.DB, {
    skillId: row.skill_id,
    status: 'pending_analysis_poll',
    bundleSha256,
    bundleSize,
    analysisId,
    nextAttemptAt: now + 5 * 60 * 1000,
    lastAttemptAt: now,
    lastSubmittedAt: now,
    errorMessage: null,
  });
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: VirusTotalEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    if (env.VT_ENABLED === '0' || !env.VIRUSTOTAL_API_KEY) {
      log.log('VirusTotal worker disabled or missing API key');
      return;
    }

    const now = Date.now();
    const pending = await loadPendingSkills(env.DB, now);
    log.log(`Processing ${pending.length} pending VirusTotal candidates`);

    for (const row of pending) {
      try {
        const claimed = await tryClaimVirusTotalWork(env.DB, {
          skillId: row.skill_id,
          status: row.vt_status,
          now,
        });
        if (!claimed) {
          continue;
        }
        await processPendingSkill(row, env);
      } catch (error) {
        log.error(`VirusTotal processing failed for ${row.skill_id}:`, error);
        await updateVirusTotalState(env.DB, {
          skillId: row.skill_id,
          status: row.vt_status,
          nextAttemptAt: now + 15 * 60 * 1000,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};
