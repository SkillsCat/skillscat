import { describe, expect, it, vi } from 'vitest';

import { calculateTier, resolveTierRecalcNextUpdateAt } from '../workers/tier-recalc';

const oldSkill = {
  id: 'skill-1',
  stars: 0,
  tier: 'cold' as const,
  next_update_at: null,
  last_accessed_at: null,
  access_count_7d: 0,
  access_count_30d: 0,
  download_count_7d: 0,
  download_count_30d: 0,
  download_count_90d: 0,
  last_commit_at: null,
};

describe('tier recalculation scheduling', () => {
  it('does not archive skills with recent download activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));

    expect(calculateTier({ ...oldSkill, download_count_90d: 1 })).toBe('cold');

    vi.useRealTimers();
  });

  it('keeps archived skills archived until the resurrection flow restores them', () => {
    expect(calculateTier({ ...oldSkill, tier: 'archived', download_count_90d: 1 })).toBe('archived');
  });

  it('preserves immediate refresh markers across tier changes', () => {
    expect(resolveTierRecalcNextUpdateAt(-1_234, 'cool')).toBe(-1_234);
  });

  it('computes a fresh schedule when no immediate refresh is pending', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));

    expect(resolveTierRecalcNextUpdateAt(null, 'warm')).toBe(
      Date.parse('2026-04-12T00:00:00.000Z')
    );

    vi.useRealTimers();
  });
});
