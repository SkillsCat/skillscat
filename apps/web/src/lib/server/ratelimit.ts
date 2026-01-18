/**
 * Rate limiting utility using Cloudflare KV
 *
 * Implements a sliding window rate limiter with configurable limits.
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
  const kvKey = `${prefix}:${key}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - config.windowSeconds;

  try {
    // Get current rate limit data
    const data = await kv.get<{ requests: number[]; }>(kvKey, 'json');
    let requests = data?.requests || [];

    // Remove expired requests (outside the window)
    requests = requests.filter(timestamp => timestamp > windowStart);

    // Check if limit exceeded
    if (requests.length >= config.limit) {
      const oldestRequest = Math.min(...requests);
      const resetAt = oldestRequest + config.windowSeconds;

      return {
        allowed: false,
        remaining: 0,
        resetAt
      };
    }

    // Add current request
    requests.push(now);

    // Save updated data
    await kv.put(kvKey, JSON.stringify({ requests }), {
      expirationTtl: config.windowSeconds * 2 // Keep data a bit longer than window
    });

    return {
      allowed: true,
      remaining: config.limit - requests.length,
      resetAt: now + config.windowSeconds
    };
  } catch (error) {
    // On error, allow the request but log
    console.error('Rate limit check failed:', error);
    return {
      allowed: true,
      remaining: config.limit,
      resetAt: now + config.windowSeconds
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
