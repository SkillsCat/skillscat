import { describe, expect, it } from 'vitest';
import { startCallbackServer } from '../src/utils/auth/callback-server';

describe('OAuth callback server', () => {
  it('ignores unrelated callbacks and accepts the matching state', async () => {
    const server = await startCallbackServer('expected', { start: 0, end: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const pending = server.waitForCallback();
      const unrelated = await fetch(`${base}/callback?error=access_denied&state=wrong`);
      expect(unrelated.status).toBe(400);
      await unrelated.text();
      const wrongPath = await fetch(`${base}/callback-extra?code=bad&state=expected`);
      expect(wrongPath.status).toBe(404);
      await wrongPath.text();
      const response = await fetch(`${base}/callback?code=good&state=expected`);
      await response.text();
      await expect(pending).resolves.toEqual({ code: 'good', state: 'expected' });
    } finally { server.close(); }
  });
  it('handles an error callback arriving before the caller begins waiting', async () => {
    const server = await startCallbackServer('expected', { start: 0, end: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/callback?error=access_denied&state=expected`);
      await response.text();
      await new Promise((resolve) => setImmediate(resolve));
      await expect(server.waitForCallback()).rejects.toThrow('access_denied');
    } finally { server.close(); }
  });
});
