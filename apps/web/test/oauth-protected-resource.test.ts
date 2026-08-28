import { describe, expect, it } from 'vitest';

describe('OAuth Protected Resource Metadata (RFC 9728)', () => {
  it('serves canonical resource metadata by default', async () => {
    const { GET } = await import('../src/routes/.well-known/oauth-protected-resource/+server');
    const response = await GET({ platform: { env: {} } } as never);
    const payload = await response.json() as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(response.headers.get('cloudflare-cdn-cache-control')).toContain('public');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(payload).toEqual({
      resource: 'https://skills.cat',
      authorization_servers: ['https://skills.cat'],
      scopes_supported: ['read', 'write', 'publish'],
      bearer_methods_supported: ['header'],
    });
  });

  it('uses the configured app URL and Cloudflare Access issuer', async () => {
    const { GET } = await import('../src/routes/.well-known/oauth-protected-resource/+server');
    const response = await GET({
      platform: {
        env: {
          PUBLIC_APP_URL: 'https://agents.example.test/',
          CLOUDFLARE_ACCESS_ISSUER: 'https://team.cloudflareaccess.com/, https://issuer.example.test',
        },
      },
    } as never);
    const payload = await response.json() as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    };

    expect(payload).toEqual({
      resource: 'https://agents.example.test',
      authorization_servers: [
        'https://team.cloudflareaccess.com',
        'https://issuer.example.test',
      ],
      scopes_supported: ['read', 'write', 'publish'],
      bearer_methods_supported: ['header'],
    });
  });

  it('returns an empty HEAD response with metadata headers', async () => {
    const { HEAD } = await import('../src/routes/.well-known/oauth-protected-resource/+server');
    const response = await HEAD({ platform: { env: {} } } as never);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });
});
