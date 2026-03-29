import type { SecurityRiskLevel, SkillSecuritySummary } from '$lib/types';
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

export function buildSkillSecuritySummary(params: {
  aiRiskLevel: string | null;
  vtLastStats: string | null;
}): SkillSecuritySummary | null {
  const aiRiskLevel = normalizeSecurityRiskLevel(params.aiRiskLevel);
  const vtStats = parseVirusTotalStats(params.vtLastStats);
  const vtRiskLevel = vtStats ? getSecurityRiskLevel(getVirusTotalOverride(vtStats)) : null;

  if (!aiRiskLevel && !vtRiskLevel) {
    return null;
  }

  return {
    aiRiskLevel,
    vtRiskLevel,
  };
}
