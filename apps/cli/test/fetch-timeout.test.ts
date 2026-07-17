import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, getRequestTimeoutMs } from '../src/utils/core/fetch';

const ORIGINAL_REQUEST_TIMEOUT = process.env.SKILLSCAT_CLI_REQUEST_TIMEOUT_MS;

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (ORIGINAL_REQUEST_TIMEOUT === undefined) {
      delete process.env.SKILLSCAT_CLI_REQUEST_TIMEOUT_MS;
    } else {
      process.env.SKILLSCAT_CLI_REQUEST_TIMEOUT_MS = ORIGINAL_REQUEST_TIMEOUT;
    }
  });

  it('rejects hung requests with ETIMEDOUT', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason);
        });
      })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(fetchWithTimeout('https://example.test/slow', { timeoutMs: 5 }))
      .rejects
      .toMatchObject({
        code: 'ETIMEDOUT',
        name: 'RequestTimeoutError',
      });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows the foreground timeout to be tuned for tests and CI', () => {
    process.env.SKILLSCAT_CLI_REQUEST_TIMEOUT_MS = '1234';

    expect(getRequestTimeoutMs()).toBe(1234);
  });
});
