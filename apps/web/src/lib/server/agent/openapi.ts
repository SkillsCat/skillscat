import { SITE_URL } from '$lib/seo/constants';

export const PUBLIC_API_KEYS = ['registry', 'tools', 'openclaw', 'mcp'] as const;

export type PublicApiKey = (typeof PUBLIC_API_KEYS)[number];

interface ApiDefinition {
  title: string;
  description: string;
  paths: Record<string, Record<string, unknown>>;
}

const jsonResponse = {
  description: 'Successful response',
  content: {
    'application/json': {
      schema: { type: 'object', additionalProperties: true },
    },
  },
};

const jsonErrorResponse = {
  description: 'Client error',
  content: {
    'application/json': {
      schema: { type: 'object', additionalProperties: true },
    },
  },
};

const standardJsonResponses = {
  '200': jsonResponse,
  '4XX': jsonErrorResponse,
};

function queryParameter(name: string, description: string, required = false) {
  return {
    name,
    in: 'query',
    required,
    description,
    schema: { type: 'string' },
  };
}

function pathParameter(name: string, description: string) {
  return {
    name,
    in: 'path',
    required: true,
    description,
    schema: { type: 'string' },
  };
}

function jsonRequestBody(description: string) {
  return {
    required: true,
    description,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
    },
  };
}

const API_DEFINITIONS: Record<PublicApiKey, ApiDefinition> = {
  registry: {
    title: 'SkillsCat Registry API',
    description: 'Public discovery endpoints used by the SkillsCat CLI and compatible clients.',
    paths: {
      '/registry/search': {
        get: {
          operationId: 'searchRegistry',
          summary: 'Search published skills',
          parameters: [
            queryParameter('q', 'Search query'),
            queryParameter('category', 'Category slug'),
            queryParameter('limit', 'Maximum number of results'),
            queryParameter('offset', 'Result offset'),
          ],
          responses: standardJsonResponses,
        },
      },
      '/registry/search/tool': {
        get: {
          operationId: 'searchRegistryTool',
          summary: 'Search published skills with the tool response contract',
          parameters: [queryParameter('q', 'Search query')],
          responses: standardJsonResponses,
        },
      },
      '/registry/repo/{owner}/{repo}': {
        get: {
          operationId: 'resolveRegistryRepository',
          summary: 'Discover skills in a GitHub repository',
          parameters: [
            pathParameter('owner', 'GitHub repository owner'),
            pathParameter('repo', 'GitHub repository name'),
            queryParameter('path', 'Optional path within the repository'),
          ],
          responses: standardJsonResponses,
        },
      },
      '/registry/skill/{owner}/{name}': {
        get: {
          operationId: 'getRegistrySkill',
          summary: 'Read a published skill',
          description: 'The name parameter may contain additional slash-delimited path segments.',
          parameters: [
            pathParameter('owner', 'Published skill owner'),
            pathParameter('name', 'Published skill name or nested name'),
          ],
          responses: standardJsonResponses,
        },
      },
    },
  },
  tools: {
    title: 'SkillsCat Tool API',
    description: 'JSON endpoints for agent tools that search and retrieve complete skill bundles.',
    paths: {
      '/api/tools/search-skills': {
        get: {
          operationId: 'searchSkillsTool',
          summary: 'Search published skills',
          parameters: [queryParameter('q', 'Search query')],
          responses: standardJsonResponses,
        },
        post: {
          operationId: 'searchSkillsToolPost',
          summary: 'Search published skills with a JSON request',
          requestBody: jsonRequestBody('Search parameters'),
          responses: standardJsonResponses,
        },
      },
      '/api/tools/resolve-repo-skills': {
        get: {
          operationId: 'resolveRepoSkillsTool',
          summary: 'Discover skills in a GitHub repository',
          parameters: [
            queryParameter('owner', 'GitHub repository owner', true),
            queryParameter('repo', 'GitHub repository name', true),
            queryParameter('path', 'Optional path within the repository'),
          ],
          responses: standardJsonResponses,
        },
        post: {
          operationId: 'resolveRepoSkillsToolPost',
          summary: 'Discover repository skills with a JSON request',
          requestBody: jsonRequestBody('Repository coordinates'),
          responses: standardJsonResponses,
        },
      },
      '/api/tools/get-skill-files': {
        get: {
          operationId: 'getSkillFilesTool',
          summary: 'Retrieve the complete file bundle for a published skill',
          parameters: [queryParameter('slug', 'Exact published skill slug', true)],
          responses: standardJsonResponses,
        },
        post: {
          operationId: 'getSkillFilesToolPost',
          summary: 'Retrieve a skill bundle with a JSON request',
          requestBody: jsonRequestBody('Published skill slug'),
          responses: standardJsonResponses,
        },
      },
    },
  },
  openclaw: {
    title: 'SkillsCat OpenClaw Compatibility API',
    description: 'ClawHub-compatible endpoints for OpenClaw clients.',
    paths: {
      '/openclaw/api/v1/search': {
        get: {
          operationId: 'searchOpenClawSkills',
          summary: 'Search OpenClaw-compatible skills',
          parameters: [queryParameter('q', 'Search query', true)],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/skills': {
        get: {
          operationId: 'listOpenClawSkills',
          summary: 'List OpenClaw-compatible skills',
          responses: standardJsonResponses,
        },
        post: {
          operationId: 'publishOpenClawSkill',
          summary: 'Publish an OpenClaw-compatible skill',
          security: [{ bearerAuth: [] }],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/skills/{slug}': {
        get: {
          operationId: 'getOpenClawSkill',
          summary: 'Get OpenClaw-compatible skill metadata',
          parameters: [pathParameter('slug', 'OpenClaw-compatible skill slug')],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/skills/{slug}/file': {
        get: {
          operationId: 'getOpenClawSkillFile',
          summary: 'Read a file from an OpenClaw-compatible skill',
          parameters: [
            pathParameter('slug', 'OpenClaw-compatible skill slug'),
            queryParameter('path', 'Relative file path', true),
          ],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/skills/{slug}/versions': {
        get: {
          operationId: 'listOpenClawSkillVersions',
          summary: 'List skill versions',
          parameters: [pathParameter('slug', 'OpenClaw-compatible skill slug')],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/skills/{slug}/versions/{version}': {
        get: {
          operationId: 'getOpenClawSkillVersion',
          summary: 'Get a skill version',
          parameters: [
            pathParameter('slug', 'OpenClaw-compatible skill slug'),
            pathParameter('version', 'Skill version'),
          ],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/download': {
        get: {
          operationId: 'downloadOpenClawSkill',
          summary: 'Download an OpenClaw-compatible skill bundle',
          parameters: [queryParameter('slug', 'OpenClaw-compatible skill slug', true)],
          responses: {
            '200': {
              description: 'Skill ZIP archive',
              content: {
                'application/zip': { schema: { type: 'string', format: 'binary' } },
              },
            },
            '4XX': jsonErrorResponse,
          },
        },
      },
      '/openclaw/api/v1/resolve': {
        get: {
          operationId: 'resolveOpenClawSkill',
          summary: 'Resolve a skill and version for download',
          parameters: [queryParameter('slug', 'OpenClaw-compatible skill slug', true)],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/stars/{slug}': {
        post: {
          operationId: 'starOpenClawSkill',
          summary: 'Star a skill',
          parameters: [pathParameter('slug', 'OpenClaw-compatible skill slug')],
          security: [{ bearerAuth: [] }],
          responses: standardJsonResponses,
        },
        delete: {
          operationId: 'unstarOpenClawSkill',
          summary: 'Remove a skill star',
          parameters: [pathParameter('slug', 'OpenClaw-compatible skill slug')],
          security: [{ bearerAuth: [] }],
          responses: standardJsonResponses,
        },
      },
      '/openclaw/api/v1/whoami': {
        get: {
          operationId: 'getOpenClawIdentity',
          summary: 'Get the authenticated OpenClaw identity',
          security: [{ bearerAuth: [] }],
          responses: standardJsonResponses,
        },
      },
    },
  },
  mcp: {
    title: 'SkillsCat MCP API',
    description: 'Streamable HTTP Model Context Protocol endpoint for SkillsCat tools.',
    paths: {
      '/mcp': {
        post: {
          operationId: 'callSkillsCatMcp',
          summary: 'Send a JSON-RPC 2.0 MCP request',
          parameters: [
            {
              name: 'MCP-Protocol-Version',
              in: 'header',
              required: false,
              schema: { type: 'string' },
            },
          ],
          requestBody: jsonRequestBody('JSON-RPC 2.0 MCP request'),
          responses: {
            ...standardJsonResponses,
            '202': { description: 'Notification accepted' },
          },
        },
      },
    },
  },
};

export function isPublicApiKey(value: string | null): value is PublicApiKey {
  return PUBLIC_API_KEYS.some((key) => key === value);
}

export function buildOpenApiDocument(api?: PublicApiKey) {
  const selectedDefinitions = api
    ? [API_DEFINITIONS[api]]
    : PUBLIC_API_KEYS.map((key) => API_DEFINITIONS[key]);

  return {
    openapi: '3.1.0',
    info: {
      title: api ? API_DEFINITIONS[api].title : 'SkillsCat Public APIs',
      version: '1.0.0',
      license: {
        name: 'AGPL-3.0',
        identifier: 'AGPL-3.0-only',
      },
      description: api
        ? API_DEFINITIONS[api].description
        : 'Public automation APIs for discovering, reading, and installing AI agent skills.',
    },
    servers: [{ url: SITE_URL }],
    security: [{ bearerAuth: [] }, {}],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
    },
    paths: Object.assign({}, ...selectedDefinitions.map((definition) => definition.paths)),
  };
}
