const OPENROUTER_FREE_PAUSE_KEY = 'openrouter:free:paused_until';
const DEFAULT_OPENROUTER_FREE_PAUSE_MS = 15 * 60 * 1000;

export class OpenRouterApiError extends Error {
  status: number;
  model: string;
  retryAfterMs: number | null;

  constructor(params: {
    model: string;
    status: number;
    message: string;
    retryAfterMs?: number | null;
  }) {
    super(params.message);
    this.name = 'OpenRouterApiError';
    this.status = params.status;
    this.model = params.model;
    this.retryAfterMs = params.retryAfterMs ?? null;
  }
}

export function isOpenRouterFreeModel(model: string): boolean {
  return model.trim() === 'openrouter/free' || model.includes(':free');
}

export function parseOpenRouterRetryAfterMs(headers: Headers): number | null {
  const value = headers.get('retry-after');
  if (!value) return null;

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(15_000, timestamp - Date.now());
  }

  return null;
}

export function isOpenRouterFreePauseError(error: unknown): error is OpenRouterApiError {
  return error instanceof OpenRouterApiError && error.status === 429 && isOpenRouterFreeModel(error.model);
}

export async function getOpenRouterFreePauseUntil(
  kv: KVNamespace | undefined,
  now: number = Date.now()
): Promise<number | null> {
  if (!kv) return null;

  const raw = await kv.get(OPENROUTER_FREE_PAUSE_KEY);
  const until = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(until) || until <= now) {
    return null;
  }

  return until;
}

export async function pauseOpenRouterFreeModels(
  kv: KVNamespace | undefined,
  params: {
    now?: number;
    retryAfterMs?: number | null;
  } = {}
): Promise<number> {
  const now = params.now ?? Date.now();
  const pauseMs = params.retryAfterMs && params.retryAfterMs > 0
    ? params.retryAfterMs
    : DEFAULT_OPENROUTER_FREE_PAUSE_MS;
  const pauseUntil = now + pauseMs;

  if (kv) {
    const ttlSeconds = Math.max(60, Math.ceil(pauseMs / 1000));
    await kv.put(OPENROUTER_FREE_PAUSE_KEY, String(pauseUntil), {
      expirationTtl: ttlSeconds,
    });
  }

  return pauseUntil;
}

