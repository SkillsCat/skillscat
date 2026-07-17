const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_REQUEST_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_ENV = 'SKILLSCAT_CLI_REQUEST_TIMEOUT_MS';
const BACKGROUND_REQUEST_TIMEOUT_ENV = 'SKILLSCAT_CLI_BACKGROUND_REQUEST_TIMEOUT_MS';

type FetchInput = RequestInfo | URL;

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

export class RequestTimeoutError extends Error {
  code = 'ETIMEDOUT';

  constructor(timeoutMs: number, url?: string) {
    super(`Request timed out after ${timeoutMs}ms${url ? `: ${url}` : ''}`);
    this.name = 'RequestTimeoutError';
  }
}

function readTimeoutMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function getRequestTimeoutMs(): number {
  return readTimeoutMs(REQUEST_TIMEOUT_ENV, DEFAULT_REQUEST_TIMEOUT_MS);
}

export function getBackgroundRequestTimeoutMs(): number {
  return readTimeoutMs(BACKGROUND_REQUEST_TIMEOUT_ENV, DEFAULT_BACKGROUND_REQUEST_TIMEOUT_MS);
}

function getInputUrl(input: FetchInput): string | undefined {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }

  return undefined;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeTimer = timer as { unref?: () => void };
  maybeTimer.unref?.();
}

export async function fetchWithTimeout(
  input: FetchInput,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = getRequestTimeoutMs(), signal, ...requestInit } = options;
  const controller = new AbortController();
  const cleanupCallbacks: Array<() => void> = [];

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const onAbort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupCallbacks.push(() => signal.removeEventListener('abort', onAbort));
    }
  }

  const timeout = setTimeout(() => {
    controller.abort(new RequestTimeoutError(timeoutMs, getInputUrl(input)));
  }, timeoutMs);
  unrefTimer(timeout);

  try {
    return await fetch(input, {
      ...requestInit,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.reason instanceof RequestTimeoutError) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    for (const cleanup of cleanupCallbacks) {
      cleanup();
    }
  }
}
