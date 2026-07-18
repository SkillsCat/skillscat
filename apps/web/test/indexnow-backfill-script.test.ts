import { describe, expect, it } from 'vitest';

import {
  getTransientRetryDelayMs,
  isTransientStatus,
  parseRetryAfterMs,
} from '../../../scripts/indexnow-backfill.mjs';

describe('IndexNow backfill retry policy', () => {
  it('retries request-timeout, too-early, and server errors only', () => {
    expect(isTransientStatus(408)).toBe(true);
    expect(isTransientStatus(425)).toBe(true);
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(200)).toBe(false);
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(429)).toBe(false);
  });

  it('uses bounded exponential backoff and honors Retry-After', () => {
    expect(getTransientRetryDelayMs(1)).toBe(1000);
    expect(getTransientRetryDelayMs(2)).toBe(2000);
    expect(getTransientRetryDelayMs(20)).toBe(60_000);
    expect(getTransientRetryDelayMs(1, '120')).toBe(60_000);
    expect(parseRetryAfterMs('3')).toBe(3000);
  });
});
