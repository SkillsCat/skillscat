import { describe, expect, it } from 'vitest';

import { buildSkillSecuritySummary } from '../src/lib/server/skill/security-summary';

describe('buildSkillSecuritySummary', () => {
  it('parses AI summary, findings, and dimension details for the skill page', () => {
    const result = buildSkillSecuritySummary({
      aiRiskLevel: 'high',
      vtLastStats: JSON.stringify({ suspicious: 1 }),
      aiSummary: 'This skill tells the agent to download and run a remote script.',
      aiDimensionsJson: JSON.stringify([
        {
          dimension: 'supply_chain_malware',
          score: 8.6,
          reason: 'downloads and executes a remote payload',
          findingCount: 1,
        },
      ]),
      aiFindingsJson: JSON.stringify([
        {
          filePath: 'scripts/install.sh',
          dimension: 'supply_chain_malware',
          score: 8.6,
          reason: 'downloads and executes a remote payload',
        },
      ]),
    });

    expect(result).toEqual({
      aiRiskLevel: 'high',
      vtRiskLevel: 'high',
      aiSummary: 'This skill tells the agent to download and run a remote script.',
      aiDimensions: [{
        dimension: 'supply_chain_malware',
        score: 8.6,
        reason: 'downloads and executes a remote payload',
        findingCount: 1,
      }],
      aiFindings: [{
        filePath: 'scripts/install.sh',
        dimension: 'supply_chain_malware',
        score: 8.6,
        reason: 'downloads and executes a remote payload',
      }],
    });
  });

  it('ignores malformed detail payloads without dropping the overall risk levels', () => {
    const result = buildSkillSecuritySummary({
      aiRiskLevel: 'fatal',
      vtLastStats: null,
      aiSummary: '',
      aiDimensionsJson: 'not-json',
      aiFindingsJson: JSON.stringify([{ filePath: '', dimension: 'prompt_injection', score: 7 }]),
    });

    expect(result).toEqual({
      aiRiskLevel: 'fatal',
      vtRiskLevel: null,
      aiSummary: null,
      aiDimensions: [],
      aiFindings: [],
    });
  });
});
