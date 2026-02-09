/**
 * Rate limiting utility using Cloudflare KV
 *
 * Implements a fixed-window counter with configurable limits.
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
}

/**
 * Check and update rate limit for a given key
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const prefix = config.prefix || 'ratelimit';
  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = Math.max(1, config.windowSeconds);
  const windowBucket = Math.floor(now / windowSeconds);
  const kvKey = `${prefix}:${key}:${windowBucket}`;
  const resetAt = (windowBucket + 1) * windowSeconds;

  try {
    const raw = await kv.get(kvKey);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    const current = Number.isFinite(count) && count > 0 ? count : 0;

    if (current >= config.limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    const next = current + 1;

    await kv.put(kvKey, String(next), {
      expirationTtl: windowSeconds * 2
    });

    return {
      allowed: true,
      remaining: Math.max(0, config.limit - next),
      resetAt
    };
  } catch (error) {
    // On error, allow the request but log
    console.error('Rate limit check failed:', error);
    return {
      allowed: true,
      remaining: config.limit,
      resetAt
    };
  }
}

/**
 * Get rate limit key from request
 */
export function getRateLimitKey(request: Request): string {
  // Use CF-Connecting-IP if available, otherwise fall back to X-Forwarded-For
  const cfIp = request.headers.get('cf-connecting-ip');
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = cfIp || forwardedFor?.split(',')[0]?.trim() || 'unknown';

  return ip;
}

/**
 * Create rate limit response headers
 */
export function rateLimitHeaders(result: RateLimitResult, config: RateLimitConfig): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(config.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt)
  };
}

// Default rate limit configs for different endpoints
export const RATE_LIMITS = {
  // Registry search: 60 requests per minute
  search: {
    limit: 60,
    windowSeconds: 60,
    prefix: 'rl:search'
  },
  // Skill fetch: 120 requests per minute
  skill: {
    limit: 120,
    windowSeconds: 60,
    prefix: 'rl:skill'
  },
  // Submit: 10 requests per hour
  submit: {
    limit: 10,
    windowSeconds: 3600,
    prefix: 'rl:submit'
  }
} as const;
