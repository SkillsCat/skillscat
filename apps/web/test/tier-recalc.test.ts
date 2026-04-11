import { describe, expect, it, vi } from 'vitest';

import { resolveTierRecalcNextUpdateAt } from '../workers/tier-recalc';

describe('tier recalculation scheduling', () => {
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
