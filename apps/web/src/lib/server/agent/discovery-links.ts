import { SITE_URL } from '$lib/seo/constants';
import type { PublicApiKey } from '$lib/server/agent/openapi';

export const API_CATALOG_PATH = '/.well-known/api-catalog';
export const API_CATALOG_PROFILE = 'https://www.rfc-editor.org/info/rfc9727';
export const API_CATALOG_CONTENT_TYPE =
  `application/linkset+json; profile="${API_CATALOG_PROFILE}"`;

const MACHINE_GUIDE_PATH = '/llm.txt';
const MACHINE_GUIDE_COMPAT_PATH = '/llms.txt';
const SERVICE_DOC_PATH = '/docs';

export const HOME_AGENT_DISCOVERY_LINK_HEADER = [
  `<${API_CATALOG_PATH}>; rel="api-catalog"; type="application/linkset+json"`,
  `<${MACHINE_GUIDE_PATH}>; rel="service-desc"; type="text/plain"`,
  `<${MACHINE_GUIDE_COMPAT_PATH}>; rel="alternate"; type="text/plain"`,
  `<${SERVICE_DOC_PATH}>; rel="service-doc"; type="text/html"`,
  `<${MACHINE_GUIDE_PATH}>; rel="describedby"; type="text/plain"`,
].join(', ');

export const API_CATALOG_LINK_HEADER =
  `<${API_CATALOG_PATH}>; rel="api-catalog"; type="application/linkset+json"`;

const OPENAPI_CONTENT_TYPE = 'application/vnd.oai.openapi+json;version=3.1';
const API_CATALOG_ENTRIES: ReadonlyArray<{
  anchorPath: string;
  api: PublicApiKey;
  docPath: string;
  docType: string;
}> = [
  { anchorPath: '/registry', api: 'registry', docPath: '/docs/cli', docType: 'text/html' },
  { anchorPath: '/api/tools', api: 'tools', docPath: '/docs', docType: 'text/html' },
  {
    anchorPath: '/openclaw/api/v1',
    api: 'openclaw',
    docPath: '/docs/openclaw',
    docType: 'text/html',
  },
  { anchorPath: '/mcp', api: 'mcp', docPath: '/llm.txt', docType: 'text/plain' },
];

export function buildApiCatalog() {
  return {
    linkset: API_CATALOG_ENTRIES.map((entry) => ({
      anchor: `${SITE_URL}${entry.anchorPath}`,
      'service-desc': [
        {
          href: `${SITE_URL}/openapi.json?api=${entry.api}`,
          type: OPENAPI_CONTENT_TYPE,
        },
      ],
      'service-doc': [
        {
          href: `${SITE_URL}${entry.docPath}`,
          type: entry.docType,
        },
      ],
    })),
  };
}

export function withHomeAgentDiscoveryLinks(
  request: Request,
  pathname: string,
  response: Response
): Response {
  if (pathname !== '/' || !['GET', 'HEAD'].includes(request.method)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.append('Link', HOME_AGENT_DISCOVERY_LINK_HEADER);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
