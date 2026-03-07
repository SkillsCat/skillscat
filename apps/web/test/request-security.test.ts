import { describe, expect, it } from 'vitest';
import { runRequestSecurity } from '../src/lib/server/request-security';

function createEvent(options: {
  pathname: string;
  routeId: string;
  method?: string;
  userAgent?: string;
}): Parameters<typeof runRequestSecurity>[0] {
  const url = new URL(`https://skills.cat${options.pathname}`);
  const headers = new Headers();

  if (options.userAgent) {
    headers.set('user-agent', options.userAgent);
  }

  return {
    url,
    request: new Request(url, {
      method: options.method ?? 'GET',
      headers,
    }),
    platform: undefined,
    route: { id: options.routeId },
  } as never;
}

describe('request security', () => {
  it('blocks blocked automation UAs on tool endpoints and preserves CORS', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/api/tools/get-skill-files',
      routeId: '/api/tools/get-skill-files',
      method: 'POST',
      userAgent: 'curl/8.7.1',
    }));

    expect(response?.status).toBe(403);
    expect(response?.headers.get('x-security-block')).toBe('ua-policy');
    expect(response?.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response?.json()).resolves.toEqual({
      error: 'Request blocked by abuse protection policy',
    });
  });

  it('blocks blocked automation UAs on rich skill detail endpoints', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/api/skills/testowner%2Fprivate-skill',
      routeId: '/api/skills/[slug]',
      userAgent: 'curl/8.7.1',
    }));

    expect(response?.status).toBe(403);
    expect(response?.headers.get('x-security-block')).toBe('ua-policy');
    await expect(response?.json()).resolves.toEqual({
      error: 'Request blocked by abuse protection policy',
    });
  });
});
