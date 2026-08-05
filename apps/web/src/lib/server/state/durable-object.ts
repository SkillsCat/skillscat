interface ExpiringValue {
  value: string;
  expiresAtEpochMs?: number;
}

interface StoredNumber {
  value: number;
  expiresAtEpochMs?: number;
}

interface StoredCounter {
  bucket: number;
  penaltyLevel: number;
  count: number;
  expiresAtEpochMs?: number;
}

interface StoredViolations {
  bucket: number;
  count: number;
  expiresAtEpochMs?: number;
}

interface RateLimitCheckBody {
  key: string;
  config: {
    limit: number;
    windowSeconds: number;
    prefix?: string;
  };
  options?: {
    burstViolationWindowSeconds?: number;
    burstViolationThreshold?: number;
    maxPenaltyLevel?: number;
    penaltyTtlLevel1Seconds?: number;
    penaltyTtlLevel2Seconds?: number;
    penaltyTtlLevel3Seconds?: number;
  };
  nowEpochSec?: number;
}

const BURST_VIOLATION_WINDOW_SECONDS = 120;
const BURST_VIOLATION_THRESHOLD = 3;
const MAX_PENALTY_LEVEL = 3;
const PENALTY_TTL_SECONDS: Record<number, number> = {
  1: 5 * 60,
  2: 15 * 60,
  3: 30 * 60,
};

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function isExpired(expiresAtEpochMs: number | undefined, nowMs: number): boolean {
  return Number.isFinite(expiresAtEpochMs) && Number(expiresAtEpochMs) <= nowMs;
}

function parseExpirationMs(body: Record<string, unknown>, nowMs: number): number | undefined {
  const expiration = Number(body.expiration);
  if (Number.isFinite(expiration) && expiration > 0) {
    return Math.floor(expiration * 1000);
  }

  const expirationTtl = Number(body.expirationTtl);
  if (Number.isFinite(expirationTtl) && expirationTtl > 0) {
    return nowMs + Math.floor(expirationTtl * 1000);
  }

  return undefined;
}

export class SkillscatStateDurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405);
    }

    const operation = new URL(request.url).pathname.replace(/^\/+/, '');
    const body = await request.json().catch(() => null);

    if (!isObject(body)) {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }

    switch (operation) {
      case 'kv/get':
        return this.handleKvGet(body);
      case 'kv/put':
        return this.handleKvPut(body);
      case 'kv/delete':
        return this.handleKvDelete(body);
      case 'rate-limit/check':
        return this.handleRateLimitCheck(body);
      default:
        return jsonResponse({ error: 'unknown_operation' }, 404);
    }
  }

  private async handleKvGet(body: Record<string, unknown>): Promise<Response> {
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key) {
      return jsonResponse({ error: 'missing_key' }, 400);
    }

    const record = await this.state.storage.get<ExpiringValue>(`kv:${key}`);
    const nowMs = Date.now();
    if (!record || isExpired(record.expiresAtEpochMs, nowMs)) {
      return jsonResponse({ value: null });
    }

    return jsonResponse({ value: record.value });
  }

  private async handleKvPut(body: Record<string, unknown>): Promise<Response> {
    const key = typeof body.key === 'string' ? body.key : '';
    const value = typeof body.value === 'string' ? body.value : null;
    if (!key || value === null) {
      return jsonResponse({ error: 'invalid_put' }, 400);
    }

    const nowMs = Date.now();
    await this.state.storage.put<ExpiringValue>(`kv:${key}`, {
      value,
      expiresAtEpochMs: parseExpirationMs(body, nowMs),
    });

    return jsonResponse({ ok: true });
  }

  private async handleKvDelete(body: Record<string, unknown>): Promise<Response> {
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key) {
      return jsonResponse({ error: 'missing_key' }, 400);
    }

    await this.state.storage.delete(`kv:${key}`);
    return jsonResponse({ ok: true });
  }

  private async getStoredNumber(key: string, nowMs: number): Promise<number> {
    const record = await this.state.storage.get<StoredNumber>(key);
    if (!record || isExpired(record.expiresAtEpochMs, nowMs)) {
      return 0;
    }

    const value = Number(record.value);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  private async putStoredNumber(key: string, value: number, ttlSeconds: number, nowMs: number): Promise<void> {
    await this.state.storage.put<StoredNumber>(key, {
      value,
      expiresAtEpochMs: nowMs + ttlSeconds * 1000,
    });
  }

  private async handleRateLimitCheck(body: Record<string, unknown>): Promise<Response> {
    const input = body as unknown as RateLimitCheckBody;
    const key = typeof input.key === 'string' ? input.key : '';
    const limit = Number(input.config?.limit);
    const windowSeconds = Number(input.config?.windowSeconds);
    if (!key || !Number.isFinite(limit) || limit <= 0 || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      return jsonResponse({ error: 'invalid_rate_limit_input' }, 400);
    }

    const now = Number.isFinite(input.nowEpochSec) && Number(input.nowEpochSec) > 0
      ? Math.floor(Number(input.nowEpochSec))
      : Math.floor(Date.now() / 1000);
    const nowMs = now * 1000;
    const storageKeyPrefix = `rate-limit:${key}`;
    const baseWindowSeconds = Math.max(1, Math.floor(windowSeconds));
    const burstViolationWindowSeconds = toPositiveInt(
      input.options?.burstViolationWindowSeconds,
      BURST_VIOLATION_WINDOW_SECONDS
    );
    const burstViolationThreshold = toPositiveInt(
      input.options?.burstViolationThreshold,
      BURST_VIOLATION_THRESHOLD
    );
    const maxPenaltyLevel = toPositiveInt(input.options?.maxPenaltyLevel, MAX_PENALTY_LEVEL);
    const penaltyTtlLevel1Seconds = toPositiveInt(
      input.options?.penaltyTtlLevel1Seconds,
      PENALTY_TTL_SECONDS[1]
    );
    const penaltyTtlLevel2Seconds = toPositiveInt(
      input.options?.penaltyTtlLevel2Seconds,
      PENALTY_TTL_SECONDS[2]
    );
    const penaltyTtlLevel3Seconds = toPositiveInt(
      input.options?.penaltyTtlLevel3Seconds,
      PENALTY_TTL_SECONDS[3]
    );

    const parsedPenalty = await this.getStoredNumber(`${storageKeyPrefix}:penalty`, nowMs);
    const penaltyLevel = parsedPenalty > 0 ? Math.min(maxPenaltyLevel, parsedPenalty) : 0;
    const penaltyFactor = penaltyLevel + 1;
    const effectiveLimit = Math.max(1, Math.floor(limit / penaltyFactor));
    const effectiveWindowSeconds = baseWindowSeconds * penaltyFactor;
    const windowBucket = Math.floor(now / effectiveWindowSeconds);
    const resetAt = (windowBucket + 1) * effectiveWindowSeconds;
    const counter = await this.state.storage.get<StoredCounter>(`${storageKeyPrefix}:counter`);
    const current = counter
      && !isExpired(counter.expiresAtEpochMs, nowMs)
      && counter.bucket === windowBucket
      && counter.penaltyLevel === penaltyLevel
      ? Math.max(0, Math.floor(Number(counter.count)))
      : 0;

    if (current >= effectiveLimit) {
      const violationBucket = Math.floor(now / burstViolationWindowSeconds);
      const violations = await this.state.storage.get<StoredViolations>(`${storageKeyPrefix}:violations`);
      const currentViolations = violations
        && !isExpired(violations.expiresAtEpochMs, nowMs)
        && violations.bucket === violationBucket
        ? Math.max(0, Math.floor(Number(violations.count)))
        : 0;
      const nextViolations = currentViolations + 1;

      await this.state.storage.put<StoredViolations>(`${storageKeyPrefix}:violations`, {
        bucket: violationBucket,
        count: nextViolations,
        expiresAtEpochMs: nowMs + burstViolationWindowSeconds * 2 * 1000,
      });

      if (nextViolations >= burstViolationThreshold && penaltyLevel < maxPenaltyLevel) {
        const nextPenaltyLevel = Math.min(maxPenaltyLevel, penaltyLevel + 1);
        await this.putStoredNumber(
          `${storageKeyPrefix}:penalty`,
          nextPenaltyLevel,
          getPenaltyTtlSeconds(
            nextPenaltyLevel,
            penaltyTtlLevel1Seconds,
            penaltyTtlLevel2Seconds,
            penaltyTtlLevel3Seconds
          ),
          nowMs
        );
      }

      return jsonResponse({
        allowed: false,
        remaining: 0,
        resetAt,
        limit: effectiveLimit,
        windowSeconds: effectiveWindowSeconds,
        penaltyLevel,
      });
    }

    const next = current + 1;
    await this.state.storage.put<StoredCounter>(`${storageKeyPrefix}:counter`, {
      bucket: windowBucket,
      penaltyLevel,
      count: next,
      expiresAtEpochMs: nowMs + effectiveWindowSeconds * 2 * 1000,
    });

    return jsonResponse({
      allowed: true,
      remaining: Math.max(0, effectiveLimit - next),
      resetAt,
      limit: effectiveLimit,
      windowSeconds: effectiveWindowSeconds,
      penaltyLevel,
    });
  }
}
