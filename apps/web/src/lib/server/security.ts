import type { DirectoryFile } from '../../../workers/shared/types';

export const SECURITY_DIMENSIONS = [
  'prompt_injection',
  'privacy_exfiltration',
  'dangerous_operations',
  'supply_chain_malware',
  'obfuscation_evasion',
] as const;

export type SecurityDimension = typeof SECURITY_DIMENSIONS[number];
export type SecurityRiskLevel = 'low' | 'mid' | 'high' | 'fatal';
export type SecurityAnalysisTier = 'free' | 'premium';
export type SecurityFileKind = 'instruction' | 'doc' | 'config' | 'code' | 'script' | 'binary';
export type SecurityReportReason = 'security' | 'copyright';
export type SecurityReportRiskLevel = SecurityRiskLevel;

export interface SecurityDimensionScore {
  dimension: SecurityDimension;
  score: number;
  reason: string;
  findingCount: number;
}

export interface SecurityFileInput {
  path: string;
  size: number;
  type: 'text' | 'binary';
  sha?: string;
  content?: string;
}

export interface SecurityFileScore {
  filePath: string;
  fileKind: SecurityFileKind;
  source: 'heuristic' | 'ai';
  dimension: SecurityDimension;
  score: number;
  reason: string;
}

export interface SecurityHeuristicResult {
  dimensions: SecurityDimensionScore[];
  fileScores: SecurityFileScore[];
  summary: string;
  maxScore: number;
  hasExecutableSurface: boolean;
  hasBinary: boolean;
  pureText: boolean;
}

export interface VirusTotalStats {
  malicious?: number | null;
  suspicious?: number | null;
  harmless?: number | null;
  undetected?: number | null;
  timeout?: number | null;
}

export const SECURITY_DIMENSION_WEIGHTS: Record<SecurityDimension, number> = {
  prompt_injection: 0.22,
  privacy_exfiltration: 0.23,
  dangerous_operations: 0.23,
  supply_chain_malware: 0.20,
  obfuscation_evasion: 0.12,
};

export const SECURITY_REPORT_FATAL_THRESHOLD = 10;
export const SECURITY_REPORT_HIGH_THRESHOLD = 6;
export const SECURITY_REPORT_MID_THRESHOLD = 3;

const TEXT_DECODER = new TextEncoder();

const INSTRUCTION_FILES = new Set(['skill.md']);
const DOC_FILES = new Set(['readme', 'readme.md', 'license', 'license.md', 'changelog', 'changelog.md']);
const CONFIG_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'xml']);
const SCRIPT_EXTENSIONS = new Set(['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd']);
const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h',
  'hpp', 'php', 'lua', 'pl', 'r', 'scala'
]);

const HEURISTIC_PATTERNS: Record<SecurityDimension, Array<{ pattern: RegExp; score: number; reason: string }>> = {
  prompt_injection: [
    { pattern: /\bignore (all|any|the) (previous|prior) instructions?\b/i, score: 7.5, reason: 'contains direct instruction override language' },
    { pattern: /\breveal (the )?(system|developer) prompt\b/i, score: 7.0, reason: 'attempts to reveal hidden prompts' },
    { pattern: /\bjailbreak\b/i, score: 6.5, reason: 'references jailbreak behavior' },
    { pattern: /\boverride (the )?(system|safety|security) (prompt|policy|instruction)s?\b/i, score: 6.2, reason: 'suggests overriding higher-priority instructions' },
  ],
  privacy_exfiltration: [
    { pattern: /\b(api[_ -]?key|secret|token|credential|password|cookie|session id|ssh key|wallet)\b/i, score: 5.8, reason: 'mentions sensitive credential material' },
    { pattern: /\b(upload|send|exfiltrat|forward|post)\b.{0,40}\b(data|logs|secrets?|credentials?)\b/i, score: 7.8, reason: 'appears to send sensitive data elsewhere' },
    { pattern: /\bcollect\b.{0,30}\b(browser history|emails?|messages|private data|contacts)\b/i, score: 6.8, reason: 'collects potentially sensitive user data' },
  ],
  dangerous_operations: [
    { pattern: /\brm\s+-rf\b/i, score: 9.0, reason: 'contains destructive shell command' },
    { pattern: /\b(drop database|truncate table|delete all records)\b/i, score: 8.5, reason: 'contains destructive database operation' },
    { pattern: /\b(sudo\b|chmod\s+777|disable (security|firewall|antivirus)|format (disk|drive))\b/i, score: 7.5, reason: 'contains high-risk system operation' },
    { pattern: /\bdeploy to production\b/i, score: 5.0, reason: 'mentions production-impacting operation' },
  ],
  supply_chain_malware: [
    { pattern: /\b(curl|wget)\b.{0,60}\b(chmod \+x|bash|sh|powershell|python)\b/i, score: 8.5, reason: 'downloads and executes remote payloads' },
    { pattern: /\b(npm|pnpm|yarn|pip|cargo|go)\b.{0,40}\b(postinstall|preinstall|prepare)\b/i, score: 6.5, reason: 'uses install hooks that can execute code' },
    { pattern: /\b(download|fetch|get)\b.{0,30}\b(executable|binary|payload)\b/i, score: 7.2, reason: 'retrieves executable artifacts' },
  ],
  obfuscation_evasion: [
    { pattern: /\b(fromcharcode|atob|base64\s+-d|powershell\s+-enc|certutil\s+-decode)\b/i, score: 7.0, reason: 'contains common obfuscation or decoding primitive' },
    { pattern: /\b(eval|new Function|exec\(|spawn\(|subprocess)\b/i, score: 5.8, reason: 'contains dynamic execution primitive' },
    { pattern: /\b(xxd\s+-r|openssl enc|gpg --decrypt)\b/i, score: 6.5, reason: 'decodes or decrypts embedded payloads' },
  ],
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function fileName(path: string): string {
  const parts = path.split('/');
  return (parts[parts.length - 1] || '').toLowerCase();
}

function extension(path: string): string {
  const name = fileName(path);
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1) : '';
}

export function classifySecurityFileKind(path: string, type: 'text' | 'binary'): SecurityFileKind {
  if (type === 'binary') {
    return 'binary';
  }

  const lowerName = fileName(path);
  const ext = extension(path);

  if (INSTRUCTION_FILES.has(lowerName)) {
    return 'instruction';
  }

  if (DOC_FILES.has(lowerName) || lowerName.endsWith('.md')) {
    return 'doc';
  }

  if (CONFIG_EXTENSIONS.has(ext) || lowerName.startsWith('.env')) {
    return 'config';
  }

  if (SCRIPT_EXTENSIONS.has(ext)) {
    return 'script';
  }

  if (CODE_EXTENSIONS.has(ext)) {
    return 'code';
  }

  return 'doc';
}

export function isPureTextFileKind(kind: SecurityFileKind): boolean {
  return kind === 'instruction' || kind === 'doc' || kind === 'config';
}

export function isPureTextSkill(files: Array<Pick<SecurityFileInput, 'path' | 'type'>>): boolean {
  return files.every((file) => isPureTextFileKind(classifySecurityFileKind(file.path, file.type)));
}

export async function buildSecurityContentFingerprint(files: Array<Pick<DirectoryFile, 'path' | 'sha' | 'size' | 'type'>>): Promise<string> {
  const normalized = files
    .map((file) => ({
      path: file.path,
      sha: file.sha || '',
      size: file.size || 0,
      type: file.type,
      kind: classifySecurityFileKind(file.path, file.type),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const digest = await crypto.subtle.digest('SHA-256', TEXT_DECODER.encode(JSON.stringify(normalized)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getSecurityRiskLevel(score: number): SecurityRiskLevel {
  if (score >= 8) return 'fatal';
  if (score >= 6) return 'high';
  if (score >= 3) return 'mid';
  return 'low';
}

export function getSecurityReportRiskLevel(count: number): SecurityReportRiskLevel {
  if (count >= SECURITY_REPORT_FATAL_THRESHOLD) return 'fatal';
  if (count >= SECURITY_REPORT_HIGH_THRESHOLD) return 'high';
  if (count >= SECURITY_REPORT_MID_THRESHOLD) return 'mid';
  return count > 0 ? 'low' : 'low';
}

export function shouldRequestPremiumByReports(stars: number, uniqueSecurityReporters: number): boolean {
  return stars > 100 && uniqueSecurityReporters >= SECURITY_REPORT_FATAL_THRESHOLD;
}

export function getVirusTotalOverride(stats: VirusTotalStats | null | undefined): number {
  if (!stats) return 0;
  if ((stats.malicious || 0) > 0) return 8.5;
  if ((stats.suspicious || 0) > 0) return 7.0;
  return 0;
}

export function computeSecurityTotalScore(
  dimensionScores: Array<Pick<SecurityDimensionScore, 'dimension' | 'score'>>,
  vtStats?: VirusTotalStats | null
): number {
  const normalized = new Map<SecurityDimension, number>();
  for (const dimension of SECURITY_DIMENSIONS) {
    normalized.set(dimension, 0);
  }

  for (const entry of dimensionScores) {
    normalized.set(entry.dimension, clampScore(entry.score));
  }

  let weightedAverage = 0;
  let maxDimension = 0;
  for (const dimension of SECURITY_DIMENSIONS) {
    const score = normalized.get(dimension) || 0;
    weightedAverage += score * SECURITY_DIMENSION_WEIGHTS[dimension];
    maxDimension = Math.max(maxDimension, score);
  }

  const maxDimensionAdjusted = Math.max(0, maxDimension - 0.5);
  const vtOverride = getVirusTotalOverride(vtStats);

  return clampScore(Math.max(weightedAverage, maxDimensionAdjusted, vtOverride));
}

function addFinding(
  fileScores: SecurityFileScore[],
  counts: Map<SecurityDimension, number>,
  reasons: Map<SecurityDimension, string[]>,
  {
    filePath,
    fileKind,
    dimension,
    score,
    reason,
  }: {
    filePath: string;
    fileKind: SecurityFileKind;
    dimension: SecurityDimension;
    score: number;
    reason: string;
  }
): void {
  fileScores.push({
    filePath,
    fileKind,
    source: 'heuristic',
    dimension,
    score: clampScore(score),
    reason,
  });
  counts.set(dimension, (counts.get(dimension) || 0) + 1);
  const dimensionReasons = reasons.get(dimension) || [];
  if (!dimensionReasons.includes(reason)) {
    dimensionReasons.push(reason);
    reasons.set(dimension, dimensionReasons);
  }
}

export function runSecurityHeuristics(files: SecurityFileInput[]): SecurityHeuristicResult {
  const counts = new Map<SecurityDimension, number>();
  const reasons = new Map<SecurityDimension, string[]>();
  const maxScores = new Map<SecurityDimension, number>();
  const fileScores: SecurityFileScore[] = [];
  let hasBinary = false;
  let hasExecutableSurface = false;

  for (const dimension of SECURITY_DIMENSIONS) {
    counts.set(dimension, 0);
    reasons.set(dimension, []);
    maxScores.set(dimension, 0);
  }

  for (const file of files) {
    const fileKind = classifySecurityFileKind(file.path, file.type);
    if (fileKind === 'binary') {
      hasBinary = true;
    }
    if (fileKind === 'binary' || fileKind === 'code' || fileKind === 'script') {
      hasExecutableSurface = true;
    }

    if (fileKind === 'binary') {
      addFinding(fileScores, counts, reasons, {
        filePath: file.path,
        fileKind,
        dimension: 'supply_chain_malware',
        score: 4.5,
        reason: 'contains binary artifact that warrants malware screening',
      });
      maxScores.set('supply_chain_malware', Math.max(maxScores.get('supply_chain_malware') || 0, 4.5));
      continue;
    }

    const content = file.content || '';
    for (const [dimension, patterns] of Object.entries(HEURISTIC_PATTERNS) as Array<[SecurityDimension, typeof HEURISTIC_PATTERNS[SecurityDimension]]>) {
      for (const entry of patterns) {
        if (!entry.pattern.test(content)) continue;
        const adjustedScore = entry.score + (fileKind === 'script' || fileKind === 'code' ? 0.6 : 0);
        addFinding(fileScores, counts, reasons, {
          filePath: file.path,
          fileKind,
          dimension,
          score: adjustedScore,
          reason: entry.reason,
        });
        maxScores.set(dimension, Math.max(maxScores.get(dimension) || 0, adjustedScore));
      }
    }
  }

  const dimensions = SECURITY_DIMENSIONS.map((dimension) => {
    const baseScore = maxScores.get(dimension) || 0;
    const findingCount = counts.get(dimension) || 0;
    const score = clampScore(baseScore + Math.min(2, Math.max(0, findingCount - 1) * 0.6));
    const reason = (reasons.get(dimension) || []).slice(0, 3).join('; ') || 'no strong indicators detected';

    return {
      dimension,
      score,
      reason,
      findingCount,
    } satisfies SecurityDimensionScore;
  });

  const summaryParts = dimensions
    .filter((dimension) => dimension.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((dimension) => `${dimension.dimension}:${dimension.score.toFixed(1)}`);

  const summary = summaryParts.length > 0
    ? `heuristic indicators -> ${summaryParts.join(', ')}`
    : 'heuristics found no strong indicators';

  return {
    dimensions,
    fileScores,
    summary,
    maxScore: Math.max(...dimensions.map((dimension) => dimension.score), 0),
    hasExecutableSurface,
    hasBinary,
    pureText: files.every((file) => isPureTextFileKind(classifySecurityFileKind(file.path, file.type))),
  };
}

export function sortDimensionsBySeverity(dimensions: SecurityDimensionScore[]): SecurityDimensionScore[] {
  return [...dimensions].sort((a, b) => b.score - a.score || a.dimension.localeCompare(b.dimension));
}

export function normalizeVirusTotalStats(value: unknown): VirusTotalStats | null {
  if (!value || typeof value !== 'object') return null;
  const stats = value as Record<string, unknown>;
  const result: VirusTotalStats = {};
  for (const key of ['malicious', 'suspicious', 'harmless', 'undetected', 'timeout'] as const) {
    const raw = stats[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      result[key] = raw;
    }
  }
  return result;
}
