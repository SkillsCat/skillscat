import { normalizeSkillSlug } from '$lib/skill-path';
import { parseRegistryRepoInput, resolveRegistryRepo } from '$lib/server/registry/repo';
import { parseRegistrySearchInput, resolveRegistrySearch } from '$lib/server/registry/search';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import { parseSkillFilesInput, resolveSkillFiles } from '$lib/server/skill/files';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const LEGACY_HTTP_PROTOCOL_VERSION = '2025-03-26';
const SKILLSCAT_MCP_INSTRUCTIONS = [
  'SkillsCat serves full skill bundles as the primary agent artifact.',
  'Use get_skill_bundle when you need an install-ready skill with SKILL.md and every companion file.',
  'Use search_skills or resolve_repo_skills to discover candidates first, then inspect get_skill_detail before install when needed.',
].join(' ');

type WaitUntilFn = (promise: Promise<unknown>) => void;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: JsonRpcError;
}

interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
  };
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpRequestContext {
  db: Parameters<typeof resolveRegistrySearch>[0]['db'];
  r2: Parameters<typeof resolveSkillFiles>[0]['r2'];
  githubToken?: string;
  request: Request;
  locals: App.Locals;
  waitUntil?: WaitUntilFn;
}

export interface McpRouteResponse {
  status: number;
  body?: JsonRpcSuccessResponse | JsonRpcErrorResponse;
}

export function isSupportedMcpProtocolVersion(version: string | null): boolean {
  if (!version) {
    return true;
  }

  return version === MCP_PROTOCOL_VERSION || version === LEGACY_HTTP_PROTOCOL_VERSION;
}

const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'search_skills',
    title: 'Search Skills',
    description: 'Search public SkillsCat skills by natural language query and optional category filters.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
        includePrivate: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'resolve_repo_skills',
    title: 'Resolve Repo Skills',
    description: 'List every indexed skill inside one repository, optionally narrowed to a specific skill path.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['owner', 'repo'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_skill_detail',
    title: 'Get Skill Detail',
    description: 'Fetch rich metadata, categories, file tree, and visibility for one skill slug.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_skill_bundle',
    title: 'Get Skill Bundle',
    description: 'Fetch the full install bundle for a skill, including SKILL.md and companion files.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  const record = asRecord(value);
  return !!record && typeof record.method === 'string';
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  status: number
): McpRouteResponse {
  return {
    status,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    },
  };
}

function successResponse(id: string | number | null, result: unknown): McpRouteResponse {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      result,
    },
  };
}

function textToolResult(text: string, structuredContent?: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function toolError(message: string, status?: number): ToolResult {
  const structuredContent = typeof status === 'number'
    ? { error: message, status }
    : { error: message };

  return textToolResult(message, structuredContent, true);
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    if (
      'body' in err &&
      err.body &&
      typeof err.body === 'object' &&
      'message' in err.body &&
      typeof err.body.message === 'string'
    ) {
      return err.body.message;
    }

    if ('message' in err && typeof err.message === 'string') {
      return err.message;
    }
  }

  return fallback;
}

function getErrorStatus(err: unknown, fallback = 500): number {
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    return err.status;
  }

  return fallback;
}

async function callTool(context: McpRequestContext, name: string, rawArguments: unknown): Promise<ToolResult> {
  const args = asRecord(rawArguments) || {};

  switch (name) {
    case 'search_skills': {
      try {
        const resolved = await resolveRegistrySearch(
          {
            db: context.db,
            request: context.request,
            locals: context.locals,
            waitUntil: context.waitUntil,
          },
          parseRegistrySearchInput(args)
        );

        return textToolResult(
          `Found ${resolved.data.total} skill candidates.`,
          resolved.data
        );
      } catch (err) {
        return toolError(getErrorMessage(err, 'Failed to search skills'), getErrorStatus(err));
      }
    }
    case 'resolve_repo_skills': {
      const input = parseRegistryRepoInput(args);
      if (!input) {
        return toolError('Invalid owner, repo, or path', 400);
      }

      try {
        const resolved = await resolveRegistryRepo(
          {
            db: context.db,
            request: context.request,
            locals: context.locals,
            waitUntil: context.waitUntil,
          },
          input
        );

        return textToolResult(
          `Resolved ${resolved.data.total} indexed skill entries from ${input.owner}/${input.repo}.`,
          resolved.data
        );
      } catch (err) {
        return toolError(getErrorMessage(err, 'Failed to resolve repo skills'), getErrorStatus(err));
      }
    }
    case 'get_skill_detail': {
      const slug = normalizeSkillSlug(String(args.slug ?? ''));
      if (!slug) {
        return toolError('Invalid skill slug', 400);
      }

      try {
        const resolved = await resolveSkillDetail(
          {
            db: context.db,
            request: context.request,
            locals: context.locals,
            waitUntil: context.waitUntil,
          },
          slug
        );

        if (!resolved.data) {
          return toolError(resolved.error || 'Skill not found', resolved.status);
        }

        return textToolResult(
          `Fetched skill detail for ${slug}.`,
          resolved.data
        );
      } catch (err) {
        return toolError(getErrorMessage(err, 'Failed to fetch skill detail'), getErrorStatus(err));
      }
    }
    case 'get_skill_bundle': {
      const input = parseSkillFilesInput(args);
      if (!input) {
        return toolError('Invalid skill slug', 400);
      }

      try {
        const resolved = await resolveSkillFiles(
          {
            db: context.db,
            r2: context.r2,
            githubToken: context.githubToken,
            request: context.request,
            locals: context.locals,
            waitUntil: context.waitUntil,
          },
          input
        );

        return textToolResult(
          `Fetched ${resolved.data.files.length} files for ${input.slug} into folder ${resolved.data.folderName}.`,
          resolved.data
        );
      } catch (err) {
        return toolError(getErrorMessage(err, 'Failed to fetch skill bundle'), getErrorStatus(err));
      }
    }
    default:
      return toolError(`Unknown tool: ${name}`, 404);
  }
}

export async function handleMcpRequest(
  context: McpRequestContext,
  payload: unknown
): Promise<McpRouteResponse> {
  if (Array.isArray(payload) || !isJsonRpcRequest(payload)) {
    return errorResponse(null, -32600, 'Invalid Request', 400);
  }

  if (payload.jsonrpc !== '2.0') {
    return errorResponse(payload.id ?? null, -32600, 'Invalid Request', 400);
  }

  const id = payload.id ?? null;
  const method = payload.method || '';

  if (method.startsWith('notifications/')) {
    return { status: 202 };
  }

  switch (method) {
    case 'initialize':
      return successResponse(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'skillscat',
          title: 'SkillsCat MCP',
          version: '0.1.0',
        },
        instructions: SKILLSCAT_MCP_INSTRUCTIONS,
      });
    case 'ping':
      return successResponse(id, {});
    case 'tools/list':
      return successResponse(id, {
        tools: MCP_TOOLS,
      });
    case 'tools/call': {
      const params = asRecord(payload.params);
      if (!params || typeof params.name !== 'string') {
        return errorResponse(id, -32602, 'Invalid params', 200);
      }

      const result = await callTool(context, params.name, params.arguments);
      return successResponse(id, result);
    }
    default:
      return errorResponse(id, -32601, 'Method not found', 200);
  }
}
