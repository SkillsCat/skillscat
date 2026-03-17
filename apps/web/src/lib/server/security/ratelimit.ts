/**
 * Rate limiting utility using Cloudflare KV
 *
 * Implements an adaptive fixed-window counter with configurable limits.
 * Repeated limit hits in a short window trigger stricter temporary limits.
 */

interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Key prefix for namespacing */
  prefix?: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  windowSeconds: number;
  penaltyLevel: number;
}

export interface AdaptiveRateLimitOptions {
  burstViolationWindowSeconds?: number;
  burstViolationThreshold?: number;
  maxPenaltyLevel?: number;
  penaltyTtlLevel1Seconds?: number;
  penaltyTtlLevel2Seconds?: number;
  penaltyTtlLevel3Seconds?: number;
}

const BURST_VIOLATION_WINDOW_SECONDS = 120;
const BURST_VIOLATION_THRESHOLD = 3;
const MAX_PENALTY_LEVEL = 3;
const PENALTY_TTL_SECONDS: Record<number, number> = {
  1: 5 * 60,
  2: 15 * 60,
  3: 30 * 60,
};

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') return fallback;
  return value > 0 ? Math.floor(value) : fallback;
}

function getPenaltyTtlSeconds(
  level: number,
  ttlLevel1: number,
  ttlLevel2: number,
  ttlLevel3: number
): number {
  if (level <= 1) return ttlLevel1;
  if (level === 2) return ttlLevel2;
  return ttlLevel3;
}

function normalizeHeaderIp(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getForwardedForIp(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function isPseudoIpv4(value: string | null): boolean {
  if (!value) return false;
  const match = value.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (!match) return false;

  const octets = value.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return octets[0] >= 240;
}

/**
 * Check and update rate limit for a given key
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  config: RateLimitConfig,
  options?: AdaptiveRateLimitOptions
): Promise<RateLimitResult> {
  const prefix = config.prefix || 'ratelimit';
  const now = Math.floor(Date.now() / 1000);
  const baseWindowSeconds = Math.max(1, config.windowSeconds);
  const penaltyKey = `${prefix}:penalty:${key}`;
  const burstViolationWindowSeconds = toPositiveInt(
    options?.burstViolationWindowSeconds,
    BURST_VIOLATION_WINDOW_SECONDS
  );
  const burstViolationThreshold = toPositiveInt(
    options?.burstViolationThreshold,
    BURST_VIOLATION_THRESHOLD
  );
  const maxPenaltyLevel = toPositiveInt(
    options?.maxPenaltyLevel,
    MAX_PENALTY_LEVEL
  );
  const penaltyTtlLevel1Seconds = toPositiveInt(
    options?.penaltyTtlLevel1Seconds,
    PENALTY_TTL_SECONDS[1]
  );
  const penaltyTtlLevel2Seconds = toPositiveInt(
    options?.penaltyTtlLevel2Seconds,
    PENALTY_TTL_SECONDS[2]
  );
  const penaltyTtlLevel3Seconds = toPositiveInt(
    options?.penaltyTtlLevel3Seconds,
    PENALTY_TTL_SECONDS[3]
  );

  try {
    const rawPenalty = await kv.get(penaltyKey);
    const parsedPenalty = rawPenalty ? Number.parseInt(rawPenalty, 10) : 0;
    const penaltyLevel = Number.isFinite(parsedPenalty) && parsedPenalty > 0
      ? Math.min(maxPenaltyLevel, parsedPenalty)
      : 0;

    const penaltyFactor = penaltyLevel + 1;
    const effectiveLimit = Math.max(1, Math.floor(config.limit / penaltyFactor));
    const effectiveWindowSeconds = baseWindowSeconds * penaltyFactor;
    const windowBucket = Math.floor(now / effectiveWindowSeconds);
    const kvKey = `${prefix}:${key}:${penaltyLevel}:${windowBucket}`;
    const resetAt = (windowBucket + 1) * effectiveWindowSeconds;

    const raw = await kv.get(kvKey);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    const current = Number.isFinite(count) && count > 0 ? count : 0;

    if (current >= effectiveLimit) {
      // Track repeated violations in a short window and escalate penalty.
      const violationBucket = Math.floor(now / burstViolationWindowSeconds);
      const violationKey = `${prefix}:violations:${key}:${violationBucket}`;
      const rawViolations = await kv.get(violationKey);
      const violationCount = rawViolations ? Number.parseInt(rawViolations, 10) : 0;
      const currentViolations = Number.isFinite(violationCount) && violationCount > 0 ? violationCount : 0;
      const nextViolations = currentViolations + 1;

      await kv.put(violationKey, String(nextViolations), {
        expirationTtl: burstViolationWindowSeconds * 2,
      });

      if (nextViolations >= burstViolationThreshold && penaltyLevel < maxPenaltyLevel) {
        const nextPenaltyLevel = Math.min(maxPenaltyLevel, penaltyLevel + 1);
        const penaltyTtlSeconds = getPenaltyTtlSeconds(
          nextPenaltyLevel,
          penaltyTtlLevel1Seconds,
          penaltyTtlLevel2Seconds,
          penaltyTtlLevel3Seconds
        );
        await kv.put(penaltyKey, String(nextPenaltyLevel), {
          expirationTtl: penaltyTtlSeconds,
        });
      }

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        limit: effectiveLimit,
        windowSeconds: effectiveWindowSeconds,
        penaltyLevel,
      };
    }

    const next = current + 1;

    await kv.put(kvKey, String(next), {
      expirationTtl: effectiveWindowSeconds * 2
    });

    return {
      allowed: true,
      remaining: Math.max(0, effectiveLimit - next),
      resetAt,
      limit: effectiveLimit,
      windowSeconds: effectiveWindowSeconds,
      penaltyLevel,
    };
  } catch (error) {
    // On error, allow the request but log
    console.error('Rate limit check failed:', error);
    return {
      allowed: true,
      remaining: config.limit,
      resetAt: now + baseWindowSeconds,
      limit: config.limit,
      windowSeconds: baseWindowSeconds,
      penaltyLevel: 0,
    };
  }
}

/**
 * Get rate limit key from request
 */
export function getRateLimitKey(request: Request): string {
  const cfIp = normalizeHeaderIp(request.headers.get('cf-connecting-ip'));
  const cfIpv6 = normalizeHeaderIp(request.headers.get('cf-connecting-ipv6'));
  const trueClientIp = normalizeHeaderIp(request.headers.get('true-client-ip'));

  if (cfIp && !(isPseudoIpv4(cfIp) && cfIpv6)) {
    return cfIp;
  }

  if (cfIpv6) {
    return cfIpv6;
  }

  if (trueClientIp) {
    return trueClientIp;
  }

  const forwardedFor = getForwardedForIp(request.headers.get('x-forwarded-for'));
  return forwardedFor || 'unknown';
}

/**
 * Create rate limit response headers
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
    'X-RateLimit-Window': String(result.windowSeconds),
    'X-RateLimit-Penalty-Level': String(result.penaltyLevel),
  };
}

// Default rate limit configs for different endpoints
export const RATE_LIMITS = {
  // Cache-backed registry and compat search reads.
  search: {
    limit: 600,
    windowSeconds: 60,
    prefix: 'rl:search'
  },
  // Cache-backed autocomplete / suggestion reads.
  autocomplete: {
    limit: 1200,
    windowSeconds: 60,
    prefix: 'rl:autocomplete'
  },
  // Cache-backed public skill detail reads.
  detail: {
    limit: 600,
    windowSeconds: 60,
    prefix: 'rl:detail'
  },
  // Cache-backed public bundle/file list reads.
  bundle: {
    limit: 300,
    windowSeconds: 60,
    prefix: 'rl:bundle'
  },
  // Cache-backed public repo lookups.
  repo: {
    limit: 300,
    windowSeconds: 60,
    prefix: 'rl:repo'
  },
  // Cache-backed public browse/list endpoints.
  browse: {
    limit: 600,
    windowSeconds: 60,
    prefix: 'rl:browse'
  },
  // Skill fetch: 240 requests per minute
  skill: {
    limit: 240,
    windowSeconds: 60,
    prefix: 'rl:skill'
  },
  // Submit: 20 requests per minute (content collection phase)
  submit: {
    limit: 20,
    windowSeconds: 60,
    prefix: 'rl:submit'
  },
  // Anonymous background submit from CLI: stricter throughput
  submitAnonymousCli: {
    limit: 6,
    windowSeconds: 60,
    prefix: 'rl:submit:anon-cli'
  },
  // Submit via API token: higher throughput with isolated token-level buckets
  submitToken: {
    limit: 120,
    windowSeconds: 60,
    prefix: 'rl:submit:token'
  }
} as const;
