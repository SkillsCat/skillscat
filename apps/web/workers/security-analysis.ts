import type {
  ExecutionContext,
  MessageBatch,
  OpenRouterResponse,
  ScheduledController,
  SecurityAnalysisEnv,
  SecurityAnalysisMessage,
} from './shared/types';
import type { D1Database } from '@cloudflare/workers-types';
import { createLogger, generateId } from './shared/utils';
import {
  getOpenRouterFreePauseUntil,
  isOpenRouterFreePauseError,
  OpenRouterApiError,
  parseOpenRouterRetryAfterMs,
  pauseOpenRouterFreeModels,
} from './shared/ai/openrouter';
import {
  buildSkillBundleFiles,
  getSkillDirectoryFiles,
  loadSecuritySkill,
  loadSkillTextFilesFromR2,
} from './shared/security';
import {
  buildSecurityContentFingerprint,
  classifySecurityFileKind,
  computeSecurityTotalScore,
  getSecurityRiskLevel,
  runSecurityHeuristics,
  sortDimensionsBySeverity,
  type SecurityDimension,
  type SecurityDimensionScore,
  type SecurityFileInput,
  type SecurityFileScore,
  type SecurityRiskLevel,
  type SecurityAnalysisTier,
} from '../src/lib/server/security';
import {
  markSkillSecurityPremiumDue,
  refreshSkillSecurityReportSummary,
  tryClaimSkillSecurityAnalysis,
} from '../src/lib/server/security/state';

const log = createLogger('SecurityAnalysis');
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_FREE_MODEL = 'openrouter/free';
const DEFAULT_MAX_AI_FILES = 8;
const DEFAULT_MAX_AI_TEXT_BYTES = 48_000;
const DEFAULT_HEURISTIC_THRESHOLD = 4.5;
const DEFAULT_STABILITY_ROUNDS = 2;
const VT_MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

interface ExistingScanRow {
  id: string;
  skill_id: string;
  content_fingerprint: string;
  analysis_tier: string;
  status: string;
  provider: string | null;
  model: string | null;
  total_score: number | null;
  risk_level: string | null;
  summary: string | null;
}

interface AiFinding {
  filePath: string;
  dimension: SecurityDimension;
  score: number;
  reason: string;
}

interface AiAssessmentResult {
  summary: string;
  dimensions: SecurityDimensionScore[];
  findings: AiFinding[];
  rounds: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

interface OpenRouterCallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

interface VirusTotalDecision {
  eligibility: string;
  status: string;
  priority: number;
  nextAttemptAt: number | null;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getFreeModelCandidates(env: SecurityAnalysisEnv): string[] {
  const configured = (env.SECURITY_FREE_MODELS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const primary = env.SECURITY_FREE_MODEL?.trim() || DEFAULT_FREE_MODEL;
  return Array.from(new Set([primary, ...configured]));
}

export function getTierModelCandidates(tier: SecurityAnalysisTier, env: SecurityAnalysisEnv): string[] {
  if (tier === 'premium') {
    const premium = env.SECURITY_PREMIUM_MODEL?.trim();
    if (premium) {
      return [premium];
    }

    return [];
  }

  return getFreeModelCandidates(env);
}

function getPremiumDueReason(message: SecurityAnalysisMessage): string | null {
  if (message.trigger === 'trending_head') {
    return 'trending_head';
  }
  if (message.requestedTier === 'premium') {
    return 'manual';
  }
  return null;
}

function canRunPremiumAnalysis(env: SecurityAnalysisEnv): boolean {
  return Boolean(env.OPENROUTER_API_KEY && env.SECURITY_PREMIUM_MODEL?.trim());
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildFilesContext(files: SecurityFileInput[]): string {
  return files.map((file) => {
    const header = `### ${file.path} (${classifySecurityFileKind(file.path, file.type)}, ${file.size} bytes)`;
    const body = file.content || '';
    return `${header}\n${body}`;
  }).join('\n\n');
}

function buildAssessmentPrompt(
  stage: 'initial' | 'review' | 'confirm' | 'final',
  files: SecurityFileInput[],
  heuristic: ReturnType<typeof runSecurityHeuristics>,
  priorJson?: string
): string {
  const heuristicSummary = sortDimensionsBySeverity(heuristic.dimensions)
    .map((dimension) => `${dimension.dimension}: ${dimension.score}/10 (${dimension.reason})`)
    .join('\n');

  const stageInstruction = stage === 'initial'
    ? 'Perform the first-pass security assessment.'
    : stage === 'review'
      ? 'Review the prior assessment, reduce false positives, and correct any unsupported claims.'
      : stage === 'confirm'
        ? 'Verify only the high-risk claims from the prior assessment and discard anything not grounded in the file contents.'
        : 'Produce the final stable verdict after considering the heuristic signals and all prior assessments.';

  const previousSection = priorJson
    ? `\nPrior assessment JSON:\n${priorJson}\n`
    : '';

  return `You are auditing an AI agent skill for security risks.

${stageInstruction}

Risk dimensions:
- prompt_injection
- privacy_exfiltration
- dangerous_operations
- supply_chain_malware
- obfuscation_evasion

Rules:
1. Score each dimension from 0.0 to 10.0.
2. Only claim a risk when the provided files contain concrete evidence.
3. Keep reasons short and evidence-based.
4. findings must reference real file paths from the provided list.
5. Return strict JSON only.

Heuristic baseline:
${heuristicSummary}
${previousSection}
Files:
${buildFilesContext(files)}

Respond with:
{
  "summary": "short summary",
  "dimensions": [
    { "dimension": "prompt_injection", "score": 1.2, "reason": "why", "findingCount": 0 }
  ],
  "findings": [
    { "filePath": "SKILL.md", "dimension": "privacy_exfiltration", "score": 6.2, "reason": "why" }
  ]
}`;
}

function parseAiAssessment(content: string): AiAssessmentResult | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;

  const parsed = JSON.parse(match[0]) as {
    summary?: unknown;
    dimensions?: Array<{
      dimension?: unknown;
      score?: unknown;
      reason?: unknown;
      findingCount?: unknown;
    }>;
    findings?: Array<{
      filePath?: unknown;
      dimension?: unknown;
      score?: unknown;
      reason?: unknown;
    }>;
  };

  const dimensions = (parsed.dimensions || [])
    .filter((entry): entry is NonNullable<typeof parsed.dimensions>[number] => Boolean(entry))
    .map((entry) => ({
      dimension: String(entry.dimension || ''),
      score: clampScore(Number(entry.score)),
      reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
      findingCount: Math.max(0, Number(entry.findingCount || 0) || 0),
    }))
    .filter((entry): entry is SecurityDimensionScore => {
      return ['prompt_injection', 'privacy_exfiltration', 'dangerous_operations', 'supply_chain_malware', 'obfuscation_evasion']
        .includes(entry.dimension);
    });

  const findings = (parsed.findings || [])
    .filter((entry): entry is NonNullable<typeof parsed.findings>[number] => Boolean(entry))
    .map((entry) => ({
      filePath: typeof entry.filePath === 'string' ? entry.filePath.trim() : '',
      dimension: String(entry.dimension || ''),
      score: clampScore(Number(entry.score)),
      reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
    }))
    .filter((entry): entry is AiFinding => {
      return Boolean(entry.filePath)
        && ['prompt_injection', 'privacy_exfiltration', 'dangerous_operations', 'supply_chain_malware', 'obfuscation_evasion']
          .includes(entry.dimension);
    });

  if (dimensions.length === 0) {
    return null;
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : 'AI assessment completed',
    dimensions,
    findings,
    rounds: 1,
    provider: 'openrouter',
    model: '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: null,
  };
}

async function callOpenRouter(
  model: string,
  prompt: string,
  apiKey: string
): Promise<OpenRouterCallResult> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://skills.cat',
      'X-Title': 'SkillsCat Security Analysis Worker',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1800,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new OpenRouterApiError({
      model,
      status: response.status,
      retryAfterMs: parseOpenRouterRetryAfterMs(response.headers),
      message: `OpenRouter API error: ${response.status} - ${errorText}`,
    });
  }

  const payload = await response.json() as OpenRouterResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned no content');
  }

  return {
    content,
    promptTokens: payload.usage?.prompt_tokens || 0,
    completionTokens: payload.usage?.completion_tokens || 0,
    totalTokens: payload.usage?.total_tokens || 0,
    costUsd: typeof payload.usage?.cost === 'number' ? roundUsd(payload.usage.cost) : null,
  };
}

function scoreFileImportance(
  file: SecurityFileInput,
  heuristicFileScores: SecurityFileScore[]
): number {
  let score = 0;
  if (file.path === 'SKILL.md') score += 4;
  const kind = classifySecurityFileKind(file.path, file.type);
  if (kind === 'script') score += 3;
  if (kind === 'code') score += 2;
  if (kind === 'config') score += 1;
  const heuristicMax = heuristicFileScores
    .filter((entry) => entry.filePath === file.path)
    .reduce((current, entry) => Math.max(current, entry.score), 0);
  score += heuristicMax;
  return score;
}

function selectFilesForAi(
  files: SecurityFileInput[],
  heuristicFileScores: SecurityFileScore[],
  env: SecurityAnalysisEnv
): SecurityFileInput[] {
  const maxFiles = parsePositiveInt(env.SECURITY_MAX_AI_FILES, DEFAULT_MAX_AI_FILES);
  const maxBytes = parsePositiveInt(env.SECURITY_MAX_AI_TEXT_BYTES, DEFAULT_MAX_AI_TEXT_BYTES);

  const candidates = [...files]
    .filter((file) => file.type === 'text' && file.content)
    .sort((left, right) => {
      const importanceDiff = scoreFileImportance(right, heuristicFileScores) - scoreFileImportance(left, heuristicFileScores);
      if (importanceDiff !== 0) return importanceDiff;
      return left.path.localeCompare(right.path);
    });

  const selected: SecurityFileInput[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    const contentBytes = new TextEncoder().encode(candidate.content || '').byteLength;
    if (selected.length >= maxFiles) break;
    if (totalBytes + contentBytes > maxBytes) continue;
    selected.push(candidate);
    totalBytes += contentBytes;
  }

  return selected;
}

function getDimensionScore(dimensions: SecurityDimensionScore[], dimension: SecurityDimension): number {
  return dimensions.find((entry) => entry.dimension === dimension)?.score || 0;
}

function isStableAssessment(previous: SecurityDimensionScore[], next: SecurityDimensionScore[]): boolean {
  return ['prompt_injection', 'privacy_exfiltration', 'dangerous_operations', 'supply_chain_malware', 'obfuscation_evasion']
    .every((dimension) => Math.abs(getDimensionScore(previous, dimension as SecurityDimension) - getDimensionScore(next, dimension as SecurityDimension)) <= 1.5);
}

async function runAiPipeline(
  files: SecurityFileInput[],
  heuristic: ReturnType<typeof runSecurityHeuristics>,
  tier: SecurityAnalysisTier,
  env: SecurityAnalysisEnv
): Promise<AiAssessmentResult | null> {
  if (!env.OPENROUTER_API_KEY) {
    return null;
  }

  const modelCandidates = getTierModelCandidates(tier, env);
  const stabilityRounds = parsePositiveInt(env.SECURITY_STABILITY_ROUNDS, DEFAULT_STABILITY_ROUNDS);
  let lastError: Error | null = null;

  for (const model of modelCandidates) {
    try {
      let previousJson: string | undefined;
      let finalAssessment: AiAssessmentResult | null = null;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;
      let hasCostData = false;

      for (let round = 1; round <= stabilityRounds; round += 1) {
        const initial = await callOpenRouter(model, buildAssessmentPrompt('initial', files, heuristic, previousJson), env.OPENROUTER_API_KEY);
        const reviewed = await callOpenRouter(model, buildAssessmentPrompt('review', files, heuristic, initial.content), env.OPENROUTER_API_KEY);
        const confirmed = await callOpenRouter(model, buildAssessmentPrompt('confirm', files, heuristic, reviewed.content), env.OPENROUTER_API_KEY);
        const finalized = await callOpenRouter(model, buildAssessmentPrompt('final', files, heuristic, confirmed.content), env.OPENROUTER_API_KEY);

        totalPromptTokens += initial.promptTokens + reviewed.promptTokens + confirmed.promptTokens + finalized.promptTokens;
        totalCompletionTokens += initial.completionTokens + reviewed.completionTokens + confirmed.completionTokens + finalized.completionTokens;
        totalTokens += initial.totalTokens + reviewed.totalTokens + confirmed.totalTokens + finalized.totalTokens;
        const roundCosts = [initial.costUsd, reviewed.costUsd, confirmed.costUsd, finalized.costUsd];
        const knownRoundCosts = roundCosts.filter((cost): cost is number => cost !== null);
        if (knownRoundCosts.length > 0) {
          hasCostData = true;
          totalCostUsd += knownRoundCosts.reduce((sum, cost) => sum + cost, 0);
        }

        const parsed = parseAiAssessment(finalized.content);
        if (!parsed) {
          throw new Error('Failed to parse AI security assessment JSON');
        }

        finalAssessment = {
          ...parsed,
          rounds: round,
          provider: 'openrouter',
          model,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens,
          estimatedCostUsd: hasCostData ? roundUsd(totalCostUsd) : null,
        };

        if (!previousJson) {
          previousJson = finalized.content;
          continue;
        }

        const previous = parseAiAssessment(previousJson);
        if (previous && isStableAssessment(previous.dimensions, finalAssessment.dimensions)) {
          break;
        }

        previousJson = finalized.content;
      }

      if (finalAssessment) {
        return finalAssessment;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (tier === 'free' && isOpenRouterFreePauseError(error)) {
        throw error;
      }
      log.error(`AI security analysis failed for model ${model}:`, error);
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

function mergeDimensions(
  heuristic: ReturnType<typeof runSecurityHeuristics>,
  aiResult: AiAssessmentResult | null
): SecurityDimensionScore[] {
  if (!aiResult) {
    return heuristic.dimensions;
  }

  return heuristic.dimensions.map((dimension) => {
    const aiDimension = aiResult.dimensions.find((entry) => entry.dimension === dimension.dimension);
    if (!aiDimension) {
      return dimension;
    }

    return {
      dimension: dimension.dimension,
      score: clampScore(Math.max(aiDimension.score, Math.max(0, dimension.score - 1))),
      reason: aiDimension.reason || dimension.reason,
      findingCount: Math.max(dimension.findingCount, aiDimension.findingCount),
    } satisfies SecurityDimensionScore;
  });
}

function mergeFileScores(
  heuristic: ReturnType<typeof runSecurityHeuristics>,
  aiResult: AiAssessmentResult | null
): SecurityFileScore[] {
  const merged = [...heuristic.fileScores];
  if (!aiResult) {
    return merged;
  }

  for (const finding of aiResult.findings) {
    merged.push({
      filePath: finding.filePath,
      fileKind: classifySecurityFileKind(finding.filePath, 'text'),
      source: 'ai',
      dimension: finding.dimension,
      score: clampScore(finding.score),
      reason: finding.reason,
    });
  }

  return merged;
}

function buildFindingsPayload(fileScores: SecurityFileScore[]): string {
  return JSON.stringify(
    fileScores
      .filter((entry) => entry.score >= 5)
      .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
      .slice(0, 20)
  );
}

async function getExistingCompletedScan(
  db: D1Database,
  skillId: string,
  contentFingerprint: string,
  tier: SecurityAnalysisTier
): Promise<ExistingScanRow | null> {
  return db.prepare(`
    SELECT
      id,
      skill_id,
      content_fingerprint,
      analysis_tier,
      status,
      provider,
      model,
      total_score,
      risk_level,
      summary
    FROM skill_security_scans
    WHERE skill_id = ?
      AND content_fingerprint = ?
      AND analysis_tier = ?
      AND status = 'completed'
    LIMIT 1
  `)
    .bind(skillId, contentFingerprint, tier)
    .first<ExistingScanRow>();
}

async function saveScanResult(
  db: D1Database,
  params: {
    scanId: string;
    skillId: string;
    contentFingerprint: string;
    tier: SecurityAnalysisTier;
    provider: string;
    model: string | null;
    totalScore: number;
    riskLevel: SecurityRiskLevel;
    summary: string;
    findingsJson: string;
    dimensions: SecurityDimensionScore[];
    fileScores: SecurityFileScore[];
    rounds: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    now: number;
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO skill_security_scans (
      id,
      skill_id,
      content_fingerprint,
      analysis_tier,
      status,
      provider,
      model,
      total_score,
      risk_level,
      summary,
      findings,
      rounds,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      estimated_cost_usd,
      analyzed_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_id, content_fingerprint, analysis_tier) DO UPDATE SET
      status = excluded.status,
      provider = excluded.provider,
      model = excluded.model,
      total_score = excluded.total_score,
      risk_level = excluded.risk_level,
      summary = excluded.summary,
      findings = excluded.findings,
      rounds = excluded.rounds,
      prompt_tokens = excluded.prompt_tokens,
      completion_tokens = excluded.completion_tokens,
      total_tokens = excluded.total_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      analyzed_at = excluded.analyzed_at,
      updated_at = excluded.updated_at
  `)
    .bind(
      params.scanId,
      params.skillId,
      params.contentFingerprint,
      params.tier,
      params.provider,
      params.model,
      params.totalScore,
      params.riskLevel,
      params.summary,
      params.findingsJson,
      params.rounds,
      params.promptTokens,
      params.completionTokens,
      params.totalTokens,
      params.estimatedCostUsd,
      params.now,
      params.now,
      params.now,
    )
    .run();

  const persisted = await db.prepare(`
    SELECT id
    FROM skill_security_scans
    WHERE skill_id = ?
      AND content_fingerprint = ?
      AND analysis_tier = ?
    LIMIT 1
  `)
    .bind(params.skillId, params.contentFingerprint, params.tier)
    .first<{ id: string }>();
  const scanId = persisted?.id || params.scanId;

  await db.prepare('DELETE FROM skill_security_scan_dimensions WHERE scan_id = ?').bind(scanId).run();
  await db.prepare('DELETE FROM skill_security_file_scores WHERE scan_id = ?').bind(scanId).run();

  for (const dimension of params.dimensions) {
    await db.prepare(`
      INSERT INTO skill_security_scan_dimensions (
        id,
        scan_id,
        dimension,
        score,
        reason,
        finding_count,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        generateId(),
        scanId,
        dimension.dimension,
        dimension.score,
        dimension.reason,
        dimension.findingCount,
        params.now,
      )
      .run();
  }

  for (const fileScore of params.fileScores) {
    await db.prepare(`
      INSERT INTO skill_security_file_scores (
        id,
        scan_id,
        file_path,
        file_kind,
        source,
        dimension,
        score,
        reason,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        generateId(),
        scanId,
        fileScore.filePath,
        fileScore.fileKind,
        fileScore.source,
        fileScore.dimension,
        fileScore.score,
        fileScore.reason,
        params.now,
      )
      .run();
  }
}

function computeVirusTotalDecision(params: {
  visibility: string;
  pureText: boolean;
  totalScore: number;
  reportRiskLevel: string;
  stars: number;
  tier: string;
  hasExecutableSurface: boolean;
  hasBinary: boolean;
  bundleSize: number;
  now: number;
}): VirusTotalDecision {
  if (params.visibility !== 'public') {
    return { eligibility: 'skipped_visibility', status: 'skipped', priority: 0, nextAttemptAt: null };
  }
  if (params.pureText) {
    return { eligibility: 'skipped_pure_text', status: 'skipped', priority: 0, nextAttemptAt: null };
  }
  if (params.bundleSize > VT_MAX_BUNDLE_BYTES) {
    return { eligibility: 'skipped_size_limit', status: 'skipped', priority: 0, nextAttemptAt: null };
  }

  let priority = 0;
  if (params.totalScore >= 8) priority += 400;
  else if (params.totalScore >= 7) priority += 320;
  else if (params.totalScore >= 6) priority += 240;

  if (params.reportRiskLevel === 'fatal') priority += 240;
  else if (params.reportRiskLevel === 'high') priority += 180;

  if (params.tier === 'hot') priority += 150;
  else if (params.tier === 'warm') priority += 80;

  if (params.stars > 100) priority += 120;
  if (params.hasBinary) priority += 120;
  else if (params.hasExecutableSurface) priority += 80;

  const eligible = priority >= 250
    || params.totalScore >= 6
    || params.reportRiskLevel === 'high'
    || params.reportRiskLevel === 'fatal'
    || (params.stars > 100 && params.hasExecutableSurface);

  if (!eligible) {
    return { eligibility: 'deferred_low_priority', status: 'pending', priority, nextAttemptAt: null };
  }

  return {
    eligibility: 'eligible',
    status: 'pending_lookup',
    priority,
    nextAttemptAt: params.now,
  };
}

function resolveVirusTotalDecision(
  state: Awaited<ReturnType<typeof loadSecuritySkill>>['state'],
  contentFingerprint: string,
  computed: VirusTotalDecision
): VirusTotalDecision {
  const shouldPreserveExisting = state?.content_fingerprint === contentFingerprint
    && computed.eligibility !== 'skipped_visibility'
    && computed.eligibility !== 'skipped_pure_text'
    && computed.eligibility !== 'skipped_size_limit'
    && computed.eligibility !== 'unknown'
    && Boolean(state.vt_eligibility)
    && state.vt_eligibility !== 'unknown'
    && Boolean(state.vt_status)
    && state.vt_status !== 'pending';

  if (!shouldPreserveExisting) {
    return computed;
  }

  return {
    eligibility: state?.vt_eligibility || computed.eligibility,
    status: state?.vt_status || computed.status,
    priority: Math.max(state?.vt_priority || 0, computed.priority),
    nextAttemptAt: state?.vt_next_attempt_at ?? computed.nextAttemptAt,
  };
}

async function updateStateFromExistingScan(
  db: D1Database,
  params: {
    skillId: string;
    contentFingerprint: string;
    existingScan: ExistingScanRow;
    requestedTier: SecurityAnalysisTier;
    reportCount: number;
    reportRiskLevel: string;
    premiumDueReason: string | null;
    premiumRequestedFingerprint: string | null;
    premiumLastAnalyzedFingerprint: string | null;
    now: number;
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      content_fingerprint,
      dirty,
      next_update_at,
      status,
      last_analyzed_at,
      current_total_score,
      current_risk_level,
      current_free_scan_id,
      current_premium_scan_id,
      open_security_report_count,
      report_risk_level,
      premium_due_reason,
      premium_requested_fingerprint,
      premium_last_analyzed_fingerprint,
      created_at,
      updated_at
    )
    VALUES (?, ?, 0, NULL, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      content_fingerprint = excluded.content_fingerprint,
      dirty = 0,
      next_update_at = NULL,
      status = excluded.status,
      last_analyzed_at = excluded.last_analyzed_at,
      current_total_score = excluded.current_total_score,
      current_risk_level = excluded.current_risk_level,
      current_free_scan_id = COALESCE(excluded.current_free_scan_id, skill_security_state.current_free_scan_id),
      current_premium_scan_id = COALESCE(excluded.current_premium_scan_id, skill_security_state.current_premium_scan_id),
      open_security_report_count = excluded.open_security_report_count,
      report_risk_level = excluded.report_risk_level,
      premium_due_reason = excluded.premium_due_reason,
      premium_requested_fingerprint = excluded.premium_requested_fingerprint,
      premium_last_analyzed_fingerprint = excluded.premium_last_analyzed_fingerprint,
      updated_at = excluded.updated_at
  `)
    .bind(
      params.skillId,
      params.contentFingerprint,
      params.now,
      params.existingScan.total_score,
      params.existingScan.risk_level,
      params.requestedTier === 'free' ? params.existingScan.id : null,
      params.requestedTier === 'premium' ? params.existingScan.id : null,
      params.reportCount,
      params.reportRiskLevel,
      params.requestedTier === 'premium' ? null : params.premiumDueReason,
      params.requestedTier === 'premium' ? null : params.premiumRequestedFingerprint,
      params.requestedTier === 'premium'
        ? params.contentFingerprint
        : params.premiumLastAnalyzedFingerprint,
      params.now,
      params.now,
    )
    .run();
}

async function updateStateAfterSuccess(
  db: D1Database,
  params: {
    skillId: string;
    contentFingerprint: string;
    tier: SecurityAnalysisTier;
    scanId: string;
    totalScore: number;
    riskLevel: SecurityRiskLevel;
    reportCount: number;
    reportRiskLevel: string;
    vtDecision: VirusTotalDecision;
    premiumDueReason: string | null;
    premiumRequestedFingerprint: string | null;
    premiumLastAnalyzedFingerprint: string | null;
    now: number;
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      content_fingerprint,
      dirty,
      next_update_at,
      status,
      last_analyzed_at,
      current_total_score,
      current_risk_level,
      current_free_scan_id,
      current_premium_scan_id,
      open_security_report_count,
      report_risk_level,
      premium_due_reason,
      premium_requested_fingerprint,
      premium_last_analyzed_fingerprint,
      vt_eligibility,
      vt_priority,
      vt_status,
      vt_next_attempt_at,
      fail_count,
      last_error,
      last_error_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, 0, NULL, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      content_fingerprint = excluded.content_fingerprint,
      dirty = 0,
      next_update_at = NULL,
      status = excluded.status,
      last_analyzed_at = excluded.last_analyzed_at,
      current_total_score = excluded.current_total_score,
      current_risk_level = excluded.current_risk_level,
      current_free_scan_id = COALESCE(excluded.current_free_scan_id, skill_security_state.current_free_scan_id),
      current_premium_scan_id = COALESCE(excluded.current_premium_scan_id, skill_security_state.current_premium_scan_id),
      open_security_report_count = excluded.open_security_report_count,
      report_risk_level = excluded.report_risk_level,
      premium_due_reason = excluded.premium_due_reason,
      premium_requested_fingerprint = excluded.premium_requested_fingerprint,
      premium_last_analyzed_fingerprint = COALESCE(excluded.premium_last_analyzed_fingerprint, skill_security_state.premium_last_analyzed_fingerprint),
      vt_eligibility = excluded.vt_eligibility,
      vt_priority = excluded.vt_priority,
      vt_status = excluded.vt_status,
      vt_next_attempt_at = excluded.vt_next_attempt_at,
      fail_count = 0,
      last_error = NULL,
      last_error_at = NULL,
      updated_at = excluded.updated_at
  `)
    .bind(
      params.skillId,
      params.contentFingerprint,
      params.now,
      params.totalScore,
      params.riskLevel,
      params.tier === 'free' ? params.scanId : null,
      params.tier === 'premium' ? params.scanId : null,
      params.reportCount,
      params.reportRiskLevel,
      params.tier === 'premium' ? null : params.premiumDueReason,
      params.tier === 'premium' ? null : params.premiumRequestedFingerprint,
      params.tier === 'premium'
        ? params.contentFingerprint
        : params.premiumLastAnalyzedFingerprint,
      params.vtDecision.eligibility,
      params.vtDecision.priority,
      params.vtDecision.status,
      params.vtDecision.nextAttemptAt,
      params.now,
      params.now,
    )
    .run();
}

async function updateStateAfterFailure(
  db: D1Database,
  params: {
    skillId: string;
    contentFingerprint: string | null;
    errorMessage: string;
    now: number;
  }
): Promise<void> {
  const nextAttemptAt = params.now + 60 * 60 * 1000;
  await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      content_fingerprint,
      dirty,
      next_update_at,
      status,
      fail_count,
      last_error,
      last_error_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, 1, ?, 'pending', 1, ?, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      content_fingerprint = COALESCE(excluded.content_fingerprint, skill_security_state.content_fingerprint),
      dirty = 1,
      next_update_at = excluded.next_update_at,
      status = excluded.status,
      fail_count = COALESCE(skill_security_state.fail_count, 0) + 1,
      last_error = excluded.last_error,
      last_error_at = excluded.last_error_at,
      updated_at = excluded.updated_at
  `)
    .bind(
      params.skillId,
      params.contentFingerprint,
      nextAttemptAt,
      params.errorMessage.slice(0, 4000),
      params.now,
      params.now,
      params.now,
    )
    .run();
}

async function deferSecurityAnalysisForOpenRouterFreePause(
  db: D1Database,
  params: {
    skillId: string;
    contentFingerprint: string;
    reportCount: number;
    reportRiskLevel: string;
    premiumDueReason: string | null;
    premiumRequestedFingerprint: string | null;
    premiumLastAnalyzedFingerprint: string | null;
    nextAttemptAt: number;
    now: number;
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO skill_security_state (
      skill_id,
      content_fingerprint,
      dirty,
      next_update_at,
      status,
      open_security_report_count,
      report_risk_level,
      premium_due_reason,
      premium_requested_fingerprint,
      premium_last_analyzed_fingerprint,
      fail_count,
      last_error,
      last_error_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, 1, ?, 'pending', ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      content_fingerprint = excluded.content_fingerprint,
      dirty = 1,
      next_update_at = excluded.next_update_at,
      status = excluded.status,
      open_security_report_count = excluded.open_security_report_count,
      report_risk_level = excluded.report_risk_level,
      premium_due_reason = excluded.premium_due_reason,
      premium_requested_fingerprint = excluded.premium_requested_fingerprint,
      premium_last_analyzed_fingerprint = excluded.premium_last_analyzed_fingerprint,
      fail_count = 0,
      last_error = NULL,
      last_error_at = NULL,
      updated_at = excluded.updated_at
  `)
    .bind(
      params.skillId,
      params.contentFingerprint,
      params.nextAttemptAt,
      params.reportCount,
      params.reportRiskLevel,
      params.premiumDueReason,
      params.premiumRequestedFingerprint,
      params.premiumLastAnalyzedFingerprint,
      params.now,
      params.now,
    )
    .run();
}

async function processSecurityMessage(message: SecurityAnalysisMessage, env: SecurityAnalysisEnv): Promise<void> {
  const now = Date.now();
  const { skill, state } = await loadSecuritySkill(env.DB, message.skillId);
  if (!skill) {
    log.warn(`Security analysis skipped, skill not found: ${message.skillId}`);
    return;
  }

  const directoryFiles = getSkillDirectoryFiles(skill);
  const contentFingerprint = state?.content_fingerprint
    || (directoryFiles.length > 0 ? await buildSecurityContentFingerprint(directoryFiles) : null);
  if (!contentFingerprint) {
    throw new Error(`Missing content fingerprint for skill ${message.skillId}`);
  }

  const reportSummary = await refreshSkillSecurityReportSummary(env.DB, skill.id, now);
  const premiumRequested = message.requestedTier === 'premium'
    || (message.trigger === 'trending_head')
    || reportSummary.shouldRequestPremium
    || (
      state?.premium_due_reason !== null
      && state?.premium_requested_fingerprint === contentFingerprint
      && state?.premium_last_analyzed_fingerprint !== contentFingerprint
    );

  const requestedTier: SecurityAnalysisTier = premiumRequested ? 'premium' : 'free';
  const premiumDueReasonFromMessage = reportSummary.shouldRequestPremium
    ? 'report_threshold'
    : getPremiumDueReason(message);
  let premiumDueReason = state?.premium_due_reason || null;
  let premiumRequestedFingerprint = state?.premium_requested_fingerprint || null;
  let premiumLastAnalyzedFingerprint = state?.premium_last_analyzed_fingerprint || null;

  if (
    requestedTier === 'premium'
    && premiumDueReasonFromMessage
    && (
      premiumRequestedFingerprint !== contentFingerprint
      || premiumDueReason !== premiumDueReasonFromMessage
    )
  ) {
    await markSkillSecurityPremiumDue(env.DB, {
      skillId: skill.id,
      contentFingerprint,
      reason: premiumDueReasonFromMessage,
      now,
    });
    premiumDueReason = premiumDueReasonFromMessage;
    premiumRequestedFingerprint = contentFingerprint;
  }

  if (requestedTier === 'premium') {
    const existingPremium = await getExistingCompletedScan(env.DB, skill.id, contentFingerprint, 'premium');
    if (existingPremium) {
      await updateStateFromExistingScan(env.DB, {
        skillId: skill.id,
        contentFingerprint,
        existingScan: existingPremium,
        requestedTier: 'premium',
        reportCount: reportSummary.openSecurityReportCount,
        reportRiskLevel: reportSummary.reportRiskLevel,
        premiumDueReason: null,
        premiumRequestedFingerprint: null,
        premiumLastAnalyzedFingerprint: contentFingerprint,
        now,
      });
      return;
    }

    if (!canRunPremiumAnalysis(env)) {
      const existingFree = await getExistingCompletedScan(env.DB, skill.id, contentFingerprint, 'free');
      if (existingFree) {
        await updateStateFromExistingScan(env.DB, {
          skillId: skill.id,
          contentFingerprint,
          existingScan: existingFree,
          requestedTier: 'free',
          reportCount: reportSummary.openSecurityReportCount,
          reportRiskLevel: reportSummary.reportRiskLevel,
          premiumDueReason,
          premiumRequestedFingerprint,
          premiumLastAnalyzedFingerprint,
          now,
        });
        return;
      }
    }
  } else {
    const existingPremium = await getExistingCompletedScan(env.DB, skill.id, contentFingerprint, 'premium');
    if (existingPremium) {
      await updateStateFromExistingScan(env.DB, {
        skillId: skill.id,
        contentFingerprint,
        existingScan: existingPremium,
        requestedTier: 'premium',
        reportCount: reportSummary.openSecurityReportCount,
        reportRiskLevel: reportSummary.reportRiskLevel,
        premiumDueReason: null,
        premiumRequestedFingerprint: null,
        premiumLastAnalyzedFingerprint: contentFingerprint,
        now,
      });
      return;
    }

    const existingRequested = await getExistingCompletedScan(env.DB, skill.id, contentFingerprint, 'free');
    if (existingRequested) {
      await updateStateFromExistingScan(env.DB, {
        skillId: skill.id,
        contentFingerprint,
        existingScan: existingRequested,
        requestedTier: 'free',
        reportCount: reportSummary.openSecurityReportCount,
        reportRiskLevel: reportSummary.reportRiskLevel,
        premiumDueReason,
        premiumRequestedFingerprint,
        premiumLastAnalyzedFingerprint,
        now,
      });
      return;
    }
  }

  const claimed = await tryClaimSkillSecurityAnalysis(env.DB, {
    skillId: skill.id,
    contentFingerprint,
    now,
  });
  if (!claimed) {
    log.log(`Security analysis skipped due to active lease for ${skill.id}`);
    return;
  }

  const textFiles = await loadSkillTextFilesFromR2(skill, env);
  const fileContentMap = new Map(textFiles.map((file) => [file.path, file.content || '']));
  const securityFiles: SecurityFileInput[] = directoryFiles.map((file) => ({
    path: file.path,
    size: file.size,
    type: file.type,
    sha: file.sha,
    content: file.type === 'text' ? fileContentMap.get(file.path) : undefined,
  }));

  if (securityFiles.length === 0) {
    throw new Error(`No files available for security analysis: ${skill.id}`);
  }

  const heuristic = runSecurityHeuristics(securityFiles);
  const heuristicThreshold = parsePositiveFloat(env.SECURITY_HEURISTIC_THRESHOLD, DEFAULT_HEURISTIC_THRESHOLD);
  const aiEligible = !heuristic.pureText
    || requestedTier === 'premium'
    || heuristic.maxScore >= heuristicThreshold
    || skill.tier === 'hot'
    || skill.tier === 'warm'
    || reportSummary.openSecurityReportCount > 0;

  const aiFiles = aiEligible ? selectFilesForAi(securityFiles, heuristic.fileScores, env) : [];
  let aiResult: AiAssessmentResult | null = null;
  let executedTier: SecurityAnalysisTier = 'free';
  let freePauseUntil = aiEligible && aiFiles.length > 0
    ? await getOpenRouterFreePauseUntil(env.KV, now)
    : null;

  if (requestedTier === 'free' && freePauseUntil) {
    await deferSecurityAnalysisForOpenRouterFreePause(env.DB, {
      skillId: skill.id,
      contentFingerprint,
      reportCount: reportSummary.openSecurityReportCount,
      reportRiskLevel: reportSummary.reportRiskLevel,
      premiumDueReason,
      premiumRequestedFingerprint,
      premiumLastAnalyzedFingerprint,
      nextAttemptAt: freePauseUntil,
      now,
    });
    log.log(`Deferred free security AI for ${skill.id} until ${new Date(freePauseUntil).toISOString()}`);
    return;
  }

  if (requestedTier === 'premium' && canRunPremiumAnalysis(env) && aiEligible && aiFiles.length > 0) {
    try {
      aiResult = await runAiPipeline(aiFiles, heuristic, 'premium', env);
      if (aiResult) {
        executedTier = 'premium';
      }
    } catch (aiError) {
      log.error(`Premium AI pipeline degraded for ${skill.id}:`, aiError);
    }

    if (!aiResult) {
      const existingFree = await getExistingCompletedScan(env.DB, skill.id, contentFingerprint, 'free');
      if (existingFree) {
        await updateStateFromExistingScan(env.DB, {
          skillId: skill.id,
          contentFingerprint,
          existingScan: existingFree,
          requestedTier: 'free',
          reportCount: reportSummary.openSecurityReportCount,
          reportRiskLevel: reportSummary.reportRiskLevel,
          premiumDueReason,
          premiumRequestedFingerprint,
          premiumLastAnalyzedFingerprint,
          now,
        });
        return;
      }
    }
  }

  if (executedTier === 'free' && aiEligible && aiFiles.length > 0) {
    freePauseUntil = freePauseUntil ?? await getOpenRouterFreePauseUntil(env.KV, now);
    if (freePauseUntil) {
      await deferSecurityAnalysisForOpenRouterFreePause(env.DB, {
        skillId: skill.id,
        contentFingerprint,
        reportCount: reportSummary.openSecurityReportCount,
        reportRiskLevel: reportSummary.reportRiskLevel,
        premiumDueReason,
        premiumRequestedFingerprint,
        premiumLastAnalyzedFingerprint,
        nextAttemptAt: freePauseUntil,
        now,
      });
      log.log(`Deferred free security AI fallback for ${skill.id} until ${new Date(freePauseUntil).toISOString()}`);
      return;
    }

    try {
      aiResult = await runAiPipeline(aiFiles, heuristic, 'free', env);
    } catch (aiError) {
      if (isOpenRouterFreePauseError(aiError)) {
        freePauseUntil = await pauseOpenRouterFreeModels(env.KV, {
          now,
          retryAfterMs: aiError.retryAfterMs,
        });
        await deferSecurityAnalysisForOpenRouterFreePause(env.DB, {
          skillId: skill.id,
          contentFingerprint,
          reportCount: reportSummary.openSecurityReportCount,
          reportRiskLevel: reportSummary.reportRiskLevel,
          premiumDueReason,
          premiumRequestedFingerprint,
          premiumLastAnalyzedFingerprint,
          nextAttemptAt: freePauseUntil,
          now,
        });
        log.log(`Paused free security AI for ${skill.id} until ${new Date(freePauseUntil).toISOString()}`);
        return;
      }
      log.error(`AI pipeline degraded to heuristic-only for ${skill.id}:`, aiError);
    }
  }

  const dimensions = mergeDimensions(heuristic, aiResult);
  const fileScores = mergeFileScores(heuristic, aiResult);
  const totalScore = computeSecurityTotalScore(dimensions);
  const riskLevel = getSecurityRiskLevel(totalScore);
  const scanId = generateId();
  const bundleFiles = await buildSkillBundleFiles(skill, env);
  const bundleSize = bundleFiles.reduce((sum, file) => sum + (file.bytes?.byteLength || 0), 0);
  const vtDecision = computeVirusTotalDecision({
    visibility: skill.visibility,
    pureText: heuristic.pureText,
    totalScore,
    reportRiskLevel: reportSummary.reportRiskLevel,
    stars: skill.stars,
    tier: skill.tier,
    hasExecutableSurface: heuristic.hasExecutableSurface,
    hasBinary: heuristic.hasBinary,
    bundleSize,
    now,
  });
  const resolvedVtDecision = resolveVirusTotalDecision(state, contentFingerprint, vtDecision);

  const summary = aiResult?.summary || heuristic.summary;
  await saveScanResult(env.DB, {
    scanId,
    skillId: skill.id,
    contentFingerprint,
    tier: executedTier,
    provider: aiResult?.provider || 'heuristic',
    model: aiResult?.model || null,
    totalScore,
    riskLevel,
    summary,
    findingsJson: buildFindingsPayload(fileScores),
    dimensions,
    fileScores,
    rounds: aiResult?.rounds || 0,
    promptTokens: aiResult?.promptTokens || 0,
    completionTokens: aiResult?.completionTokens || 0,
    totalTokens: aiResult?.totalTokens || 0,
    estimatedCostUsd: aiResult?.estimatedCostUsd ?? null,
    now,
  });

  const persisted = await getExistingCompletedScan(env.DB, skill.id, contentFingerprint, executedTier);
  await updateStateAfterSuccess(env.DB, {
    skillId: skill.id,
    contentFingerprint,
    tier: executedTier,
    scanId: persisted?.id || scanId,
    totalScore,
    riskLevel,
    reportCount: reportSummary.openSecurityReportCount,
    reportRiskLevel: reportSummary.reportRiskLevel,
    vtDecision: resolvedVtDecision,
    premiumDueReason,
    premiumRequestedFingerprint,
    premiumLastAnalyzedFingerprint,
    now,
  });

  log.log(
    `Security analysis completed for ${skill.id} (${executedTier})`,
    JSON.stringify({
      requestedTier,
      executedTier,
      totalScore,
      riskLevel,
      provider: aiResult?.provider || 'heuristic',
      model: aiResult?.model || null,
      reportRiskLevel: reportSummary.reportRiskLevel,
      vtEligibility: resolvedVtDecision.eligibility,
    })
  );
}

async function loadDueSkillIds(db: D1Database, now: number, limit: number): Promise<string[]> {
  const existing = await db.prepare(`
    SELECT skill_id AS id
    FROM skill_security_state
    WHERE dirty = 1
      AND (next_update_at IS NULL OR next_update_at <= ?)
    ORDER BY COALESCE(next_update_at, 0) ASC, updated_at ASC
    LIMIT ?
  `)
    .bind(now, limit)
    .all<{ id: string }>();

  const ids = new Set((existing.results || []).map((row) => row.id));
  if (ids.size >= limit) {
    return Array.from(ids);
  }

  const remaining = limit - ids.size;
  const missing = await db.prepare(`
    SELECT s.id
    FROM skills s
    LEFT JOIN skill_security_state ss ON ss.skill_id = s.id
    WHERE ss.skill_id IS NULL
    ORDER BY s.updated_at DESC
    LIMIT ?
  `)
    .bind(remaining)
    .all<{ id: string }>();

  for (const row of missing.results || []) {
    ids.add(row.id);
  }

  return Array.from(ids);
}

export default {
  async queue(
    batch: MessageBatch<SecurityAnalysisMessage>,
    env: SecurityAnalysisEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    log.log(`Processing security batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
        await processSecurityMessage(message.body, env);
        message.ack();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Security analysis failed for message ${message.id}:`, error);
        await updateStateAfterFailure(env.DB, {
          skillId: message.body.skillId,
          contentFingerprint: null,
          errorMessage,
          now: Date.now(),
        });
        message.retry();
      }
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: SecurityAnalysisEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    const dueSkillIds = await loadDueSkillIds(env.DB, Date.now(), 10);
    if (dueSkillIds.length === 0) {
      return;
    }

    for (const skillId of dueSkillIds) {
      try {
        await processSecurityMessage({
          type: 'analyze_security',
          skillId,
          trigger: 'manual',
          requestedTier: 'auto',
        }, env);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Scheduled security analysis failed for ${skillId}:`, error);
        await updateStateAfterFailure(env.DB, {
          skillId,
          contentFingerprint: null,
          errorMessage,
          now: Date.now(),
        });
      }
    }
  },
};
