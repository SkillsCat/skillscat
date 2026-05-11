import { describe, expect, it } from 'vitest';

import {
  buildTopRatedSortScoreSql,
  getTopRatedMomentumRequirement,
  getTopRatedSortScore,
} from '../src/lib/server/ranking';

describe('top-rated ranking', () => {
  it('keeps total stars ahead of short-term momentum for uneven peers', () => {
    const staleLeader = getTopRatedSortScore(10_000, 200, 10);
    const growingPeer = getTopRatedSortScore(5_000, 200, 120);

    expect(staleLeader).toBeGreaterThan(growingPeer);
  });

  it('lets sustained growth beat a stale star lead at closer scale', () => {
    const staleLeader = getTopRatedSortScore(50_000, 200, 10);
    const growingPeer = getTopRatedSortScore(30_000, 200, 120);

    expect(growingPeer).toBeGreaterThan(staleLeader);
  });

  it('keeps maintained star leaders ahead of comparable growing projects', () => {
    const maintainedLeader = getTopRatedSortScore(10_000, 200, 120);
    const growingPeer = getTopRatedSortScore(5_000, 200, 120);

    expect(maintainedLeader).toBeGreaterThan(growingPeer);
  });

  it('does not let small projects jump established projects on momentum alone', () => {
    const smallButHot = getTopRatedSortScore(100, 2, 120);
    const established = getTopRatedSortScore(1_500, 100, 70);

    expect(established).toBeGreaterThan(smallButHot);
  });

  it('requires stronger momentum as the star base grows', () => {
    expect(getTopRatedMomentumRequirement(10_000))
      .toBeGreaterThan(getTopRatedMomentumRequirement(1_000));
  });

  it('includes the momentum expression in SQL rankings', () => {
    const sql = buildTopRatedSortScoreSql('stars', 'download_count_90d', 'trending_score');

    expect(sql).toContain('trending_score');
    expect(sql).toContain('(0.78');
  });
});
