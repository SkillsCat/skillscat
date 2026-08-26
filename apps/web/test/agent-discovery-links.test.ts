import { describe, expect, it } from 'vitest';
import {
  API_CATALOG_CONTENT_TYPE,
  API_CATALOG_LINK_HEADER,
  API_CATALOG_PATH,
  HOME_AGENT_DISCOVERY_LINK_HEADER,
  buildApiCatalog,
  withHomeAgentDiscoveryLinks,
} from '../src/lib/server/agent/discovery-links';

describe('agent discovery links', () => {
  it('advertises all registered discovery relation types', () => {
    expect(HOME_AGENT_DISCOVERY_LINK_HEADER).toContain(
      `<${API_CATALOG_PATH}>; rel="api-catalog"`
    );
    expect(HOME_AGENT_DISCOVERY_LINK_HEADER).toContain('rel="service-desc"');
    expect(HOME_AGENT_DISCOVERY_LINK_HEADER).toContain('rel="service-doc"');
    expect(HOME_AGENT_DISCOVERY_LINK_HEADER).toContain('rel="describedby"');
  });

  it.each(['GET', 'HEAD'])('adds Link headers to %s homepage responses', (method) => {
    const request = new Request('https://skills.cat/', { method });
    const response = withHomeAgentDiscoveryLinks(
      request,
      '/',
      new Response(method === 'HEAD' ? null : '<html></html>')
    );

    expect(response.headers.get('Link')).toBe(HOME_AGENT_DISCOVERY_LINK_HEADER);
  });

  it('does not advertise homepage links on other routes or methods', () => {
    const routeResponse = withHomeAgentDiscoveryLinks(
      new Request('https://skills.cat/trending'),
      '/trending',
      new Response()
    );
    const postResponse = withHomeAgentDiscoveryLinks(
      new Request('https://skills.cat/', { method: 'POST' }),
      '/',
      new Response()
    );

    expect(routeResponse.headers.has('Link')).toBe(false);
    expect(postResponse.headers.has('Link')).toBe(false);
  });

  it('builds an RFC 9727 Linkset catalog for public API endpoints', () => {
    const catalog = buildApiCatalog();

    expect(API_CATALOG_CONTENT_TYPE).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
    );
    expect(API_CATALOG_LINK_HEADER).toContain('rel="api-catalog"');
    expect(catalog.linkset.length).toBeGreaterThan(0);
    expect(catalog.linkset).toEqual(expect.arrayContaining([
      expect.objectContaining({
        anchor: 'https://skills.cat/mcp',
        'service-desc': expect.arrayContaining([
          expect.objectContaining({
            href: 'https://skills.cat/openapi.json?api=mcp',
            type: 'application/vnd.oai.openapi+json;version=3.1',
          }),
        ]),
        'service-doc': expect.arrayContaining([
          expect.objectContaining({ href: 'https://skills.cat/llm.txt' }),
        ]),
      }),
    ]));
  });
});
