import { describe, expect, it } from 'vitest';

import {
  buildImmediateRefreshNextUpdateAt,
  resolveNextUpdateAtAfterAccess,
  shouldMarkSkillNeedsUpdate,
} from '../src/lib/server/db/business/access';

describe('access business refresh markers', () => {
  it('encodes immediate refresh markers as negative timestamps', () => {
    expect(buildImmediateRefreshNextUpdateAt(1_234)).toBe(-1_234);
  });

  it('does not re-mark a skill that already has an immediate refresh marker', () => {
    expect(shouldMarkSkillNeedsUpdate({
      tier: 'cold',
      nextUpdateAt: -1_234,
      lastAccessedAt: 1_000,
      occurredAt: 2_000,
    })).toBe(false);
  });

  it('marks stale cold skills for immediate refresh without a separate KV key', () => {
    expect(resolveNextUpdateAtAfterAccess({
      tier: 'cold',
      nextUpdateAt: Date.parse('2026-04-01T00:00:00.000Z'),
      lastAccessedAt: Date.parse('2026-03-01T00:00:00.000Z'),
      occurredAt: Date.parse('2026-04-11T00:00:00.000Z'),
    })).toBe(-Date.parse('2026-04-11T00:00:00.000Z'));
  });

  it('never marks archived skills for trending refresh', () => {
    expect(resolveNextUpdateAtAfterAccess({
      tier: 'archived',
      nextUpdateAt: null,
      lastAccessedAt: null,
      occurredAt: Date.parse('2026-04-11T00:00:00.000Z'),
    })).toBeNull();
  });
});
