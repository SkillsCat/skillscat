import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, getRequestTimeoutMs } from '../src/utils/core/fetch';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const ORIGINAL_REQUEST_TIMEOUT = process.env.SKILLSCAT_CLI_REQUEST_TIMEOUT_MS;

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (ORIGINAL_REQUEST_TIMEOUT === undefined) {
      delete process.env.SKILLSCAT_CLI_REQUEST_TIMEOUT_MS;
    } else {
      process.env.SKILLSCAT_CLI_REQUEST_TIMEOUT_MS = ORIGINAL_REQUEST_TIMEOUT;
    }
  });

  it('removes the caller abort listener when an unread response times out', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unread body')));
    await fetchWithTimeout('https://example.test/unread', { signal: controller.signal, timeoutMs: 10 });
    expect(removeListener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('allows an explicit null signal to override the Request signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request('https://example.test/no-body', { signal: controller.signal });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(false);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchWithTimeout(request, { signal: null })).status).toBe(204);
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

  it('times out when headers arrive but the response body stalls', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { timeoutMs: 100 });
      await expect(response.json()).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
