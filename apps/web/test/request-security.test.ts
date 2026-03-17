import { describe, expect, it } from 'vitest';
import { runRequestSecurity, shouldNoIndexPath } from '../src/lib/server/security/request';

function createEvent(options: {
  pathname: string;
  routeId: string;
  method?: string;
  userAgent?: string;
  origin?: string;
}): Parameters<typeof runRequestSecurity>[0] {
  const url = new URL(`https://skills.cat${options.pathname}`);
  const headers = new Headers();

  if (options.userAgent) {
    headers.set('user-agent', options.userAgent);
  }

  if (options.origin) {
    headers.set('origin', options.origin);
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

  it('blocks blocked automation UAs on the MCP endpoint', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/mcp',
      routeId: '/mcp',
      method: 'POST',
      userAgent: 'curl/8.7.1',
    }));

    expect(response?.status).toBe(403);
    expect(response?.headers.get('x-security-block')).toBe('ua-policy');
    await expect(response?.json()).resolves.toEqual({
      error: 'Request blocked by abuse protection policy',
    });
  });

  it('allows descriptive MCP client user agents on the MCP endpoint', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/mcp',
      routeId: '/mcp',
      method: 'POST',
      userAgent: 'Claude-Desktop/1.0',
    }));

    expect(response).toBeNull();
  });

  it('allows OpenClaw user agents on protected skill endpoints', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/api/skills/testowner%2Fdemo/files',
      routeId: '/api/skills/[slug]/files',
      userAgent: 'OpenClaw/1.4.0',
    }));

    expect(response).toBeNull();
  });

  it('does not apply native UA protection to OpenClaw compat endpoints', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/openclaw/api/v1/search',
      routeId: '/openclaw/api/v1/search',
      userAgent: 'curl/8.7.1',
    }));

    expect(response).toBeNull();
  });

  it('does not gate public HTML pages for crawlers', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/skills/testowner/demo-skill',
      routeId: '/skills/[owner]/[...name]',
      userAgent: 'Googlebot/2.1',
    }));

    expect(response).toBeNull();
  });

  it('blocks cross-origin browser requests to the MCP endpoint', async () => {
    const response = await runRequestSecurity(createEvent({
      pathname: '/mcp',
      routeId: '/mcp',
      method: 'POST',
      userAgent: 'Mozilla/5.0',
      origin: 'https://example.com',
    }));

    expect(response?.status).toBe(403);
    expect(response?.headers.get('x-security-block')).toBe('mcp-origin');
    await expect(response?.json()).resolves.toEqual({
      error: 'Invalid MCP request origin',
    });
  });

  it('keeps crawlable public pages indexable at the hook layer', () => {
    expect(shouldNoIndexPath('/')).toBe(false);
    expect(shouldNoIndexPath('/skills/testowner/demo-skill')).toBe(false);
    expect(shouldNoIndexPath('/trending')).toBe(false);
    expect(shouldNoIndexPath('/recent')).toBe(false);
    expect(shouldNoIndexPath('/top')).toBe(false);
    expect(shouldNoIndexPath('/categories')).toBe(false);
    expect(shouldNoIndexPath('/category/seo')).toBe(false);
    expect(shouldNoIndexPath('/u/backrunner')).toBe(false);
    expect(shouldNoIndexPath('/org/skillscat')).toBe(false);
  });
});
