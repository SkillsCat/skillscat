import type {
  SecurityDimension,
  SecurityRiskLevel,
  SkillSecurityDimension,
  SkillSecurityFinding,
  SkillSecuritySummary,
} from '$lib/types';
import { getSecurityRiskLevel, getVirusTotalOverride, normalizeVirusTotalStats } from '$lib/server/security';

function normalizeSecurityRiskLevel(value: string | null): SecurityRiskLevel | null {
  if (value === 'low' || value === 'mid' || value === 'high' || value === 'fatal') {
    return value;
  }
  return null;
}

function parseVirusTotalStats(raw: string | null): ReturnType<typeof normalizeVirusTotalStats> {
  if (!raw) return null;
  try {
    return normalizeVirusTotalStats(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeDimension(value: unknown): SecurityDimension | null {
  return value === 'prompt_injection'
    || value === 'privacy_exfiltration'
    || value === 'dangerous_operations'
    || value === 'supply_chain_malware'
    || value === 'obfuscation_evasion'
    ? value
    : null;
}

function parseSecurityDimensions(raw: string | null): SkillSecurityDimension[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Array<{
      dimension?: unknown;
      score?: unknown;
      reason?: unknown;
      findingCount?: unknown;
    }>;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        const dimension = normalizeDimension(entry?.dimension);
        if (!dimension) return null;

        return {
          dimension,
          score: Number.isFinite(Number(entry?.score)) ? Math.max(0, Math.min(10, Number(entry?.score))) : 0,
          reason: typeof entry?.reason === 'string' ? entry.reason.trim() : '',
          findingCount: Number.isFinite(Number(entry?.findingCount))
            ? Math.max(0, Number(entry.findingCount))
            : 0,
        } satisfies SkillSecurityDimension;
      })
      .filter((entry): entry is SkillSecurityDimension => Boolean(entry));
  } catch {
    return [];
  }
}

function parseSecurityFindings(raw: string | null): SkillSecurityFinding[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Array<{
      filePath?: unknown;
      dimension?: unknown;
      score?: unknown;
      reason?: unknown;
    }>;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        const dimension = normalizeDimension(entry?.dimension);
        const filePath = typeof entry?.filePath === 'string' ? entry.filePath.trim() : '';
        if (!dimension || !filePath) return null;

        return {
          filePath,
          dimension,
          score: Number.isFinite(Number(entry?.score)) ? Math.max(0, Math.min(10, Number(entry?.score))) : 0,
          reason: typeof entry?.reason === 'string' ? entry.reason.trim() : '',
        } satisfies SkillSecurityFinding;
      })
      .filter((entry): entry is SkillSecurityFinding => Boolean(entry));
  } catch {
    return [];
  }
}

export function buildSkillSecuritySummary(params: {
  aiRiskLevel: string | null;
  vtLastStats: string | null;
  aiSummary: string | null;
  aiDimensionsJson: string | null;
  aiFindingsJson: string | null;
}): SkillSecuritySummary | null {
  const aiRiskLevel = normalizeSecurityRiskLevel(params.aiRiskLevel);
  const vtStats = parseVirusTotalStats(params.vtLastStats);
  const vtRiskLevel = vtStats ? getSecurityRiskLevel(getVirusTotalOverride(vtStats)) : null;
  const aiSummary = params.aiSummary?.trim() || null;
  const aiDimensions = parseSecurityDimensions(params.aiDimensionsJson);
  const aiFindings = parseSecurityFindings(params.aiFindingsJson);

  if (!aiRiskLevel && !vtRiskLevel && !aiSummary && aiDimensions.length === 0 && aiFindings.length === 0) {
    return null;
  }

  return {
    aiRiskLevel,
    vtRiskLevel,
    aiSummary,
    aiDimensions,
    aiFindings,
  };
}
