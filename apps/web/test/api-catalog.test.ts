import { describe, expect, it } from 'vitest';

describe('RFC 9727 API catalog', () => {
  it('publishes a linkset with descriptions and docs for every public API', async () => {
    const { GET } = await import('../src/routes/.well-known/api-catalog/+server');
    const response = await GET({} as never);
    const payload = await response.json() as {
      linkset: Array<{
        anchor: string;
        'service-desc': Array<{ href: string; type: string }>;
        'service-doc': Array<{ href: string; type: string }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/linkset+json');
    expect(response.headers.get('content-type')).toContain('https://www.rfc-editor.org/info/rfc9727');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(response.headers.get('link')).toContain('rel="api-catalog"');
    expect(payload.linkset).toHaveLength(4);

    for (const entry of payload.linkset) {
      expect(entry.anchor).toMatch(/^https:\/\/skills\.cat\//);
      expect(entry['service-desc']).toEqual([
        expect.objectContaining({
          href: expect.stringMatching(/^https:\/\/skills\.cat\/openapi\.json\?api=/),
          type: expect.stringContaining('openapi+json'),
        }),
      ]);
      expect(entry['service-doc']).toEqual([
        expect.objectContaining({ href: expect.stringMatching(/^https:\/\/skills\.cat\//) }),
      ]);
    }
  });

  it('returns an empty HEAD response with the catalog link relation', async () => {
    const { HEAD } = await import('../src/routes/.well-known/api-catalog/+server');
    const response = await HEAD({} as never);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('link')).toContain('rel="api-catalog"');
  });
});

describe('OpenAPI service descriptions', () => {
  it.each(['registry', 'tools', 'openclaw', 'mcp'])('serves the %s API description', async (api) => {
    const { GET } = await import('../src/routes/openapi.json/+server');
    const response = await GET({
      url: new URL(`https://skills.cat/openapi.json?api=${api}`),
    } as never);
    const payload = await response.json() as {
      openapi: string;
      servers: Array<{ url: string }>;
      paths: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.oai.openapi+json');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(payload.openapi).toBe('3.1.0');
    expect(payload.servers).toEqual([{ url: 'https://skills.cat' }]);
    expect(Object.keys(payload.paths).length).toBeGreaterThan(0);
  });

  it('rejects unknown API descriptions without shared caching', async () => {
    const { GET } = await import('../src/routes/openapi.json/+server');
    const response = await GET({
      url: new URL('https://skills.cat/openapi.json?api=private'),
    } as never);

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
