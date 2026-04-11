import { describe, expect, it } from 'vitest';

import {
  buildRepoQueuedDedupIdentity,
  computeAllowedSearchPages,
  shouldRunSearchDiscoveryThisTick,
} from '../workers/github-events';

describe('github-events helpers', () => {
  it('throttles code search to one run per configured interval window', () => {
    expect(shouldRunSearchDiscoveryThisTick(0, 300, 900)).toBe(true);
    expect(shouldRunSearchDiscoveryThisTick(300_000, 300, 900)).toBe(false);
    expect(shouldRunSearchDiscoveryThisTick(600_000, 300, 900)).toBe(false);
    expect(shouldRunSearchDiscoveryThisTick(900_000, 300, 900)).toBe(true);
    expect(shouldRunSearchDiscoveryThisTick(1_200_000, 300, 900)).toBe(false);
    expect(shouldRunSearchDiscoveryThisTick(1_800_000, 300, 900)).toBe(true);
  });

  it('always runs code search when the configured interval is not wider than the cron interval', () => {
    expect(shouldRunSearchDiscoveryThisTick(300_000, 300, 300)).toBe(true);
    expect(shouldRunSearchDiscoveryThisTick(300_000, 300, 60)).toBe(true);
  });

  it('normalizes repo queue dedupe identities for root and nested skill paths', () => {
    expect(buildRepoQueuedDedupIdentity('Owner', 'Repo')).toBe('owner/repo:');
    expect(buildRepoQueuedDedupIdentity('Owner', 'Repo', '/Nested/Path/')).toBe('owner/repo:nested/path');
  });

  it('keeps search page budgeting behavior unchanged', () => {
    expect(computeAllowedSearchPages(1, 1500, 900, 300, 300, 0)).toBe(1);
    expect(computeAllowedSearchPages(3, 250, 900, 300, 300, 0)).toBe(0);
  });
});
