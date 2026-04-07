import { describe, expect, it } from 'vitest';
import {
  getNextRecommendUpdateAt,
  shouldIncludeSkillInRecommendPrecompute,
} from '../src/lib/server/ranking/recommend-precompute';

describe('recommend precompute scheduling', () => {
  it('uses more conservative hot and warm refresh intervals', () => {
    const now = 1_700_000_000_000;

    expect(getNextRecommendUpdateAt('hot', now)).toBe(now + 12 * 60 * 60 * 1000);
    expect(getNextRecommendUpdateAt('warm', now)).toBe(now + 72 * 60 * 60 * 1000);
    expect(getNextRecommendUpdateAt('cool', now)).toBe(now + 14 * 24 * 60 * 60 * 1000);
    expect(getNextRecommendUpdateAt('cold', now)).toBeNull();
  });

  it('only keeps recently accessed cool skills eligible for cron precompute', () => {
    const now = 1_700_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;

    expect(shouldIncludeSkillInRecommendPrecompute('hot', null, now)).toBe(true);
    expect(shouldIncludeSkillInRecommendPrecompute('warm', null, now)).toBe(true);
    expect(shouldIncludeSkillInRecommendPrecompute('cool', now - 20 * dayMs, now)).toBe(true);
    expect(shouldIncludeSkillInRecommendPrecompute('cool', now - 40 * dayMs, now)).toBe(false);
    expect(shouldIncludeSkillInRecommendPrecompute('cold', now, now)).toBe(false);
  });
});
