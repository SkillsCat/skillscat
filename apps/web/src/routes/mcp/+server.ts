import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  MCP_PROTOCOL_VERSION,
  handleMcpRequest,
  isSupportedMcpProtocolVersion,
} from '$lib/server/agent/mcp';
import { getGitHubRequestAuthFromEnv } from '$lib/server/github-client/env';

function responseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    ...extra,
  };
}

function getRequestId(payload: unknown): string | number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const id = (payload as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function getRequestMethod(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const method = (payload as { method?: unknown }).method;
  return typeof method === 'string' ? method : null;
}

export const GET: RequestHandler = async () => {
  return json(
    {
      error: 'SkillsCat MCP uses POST with JSON-RPC 2.0 requests.',
    },
    {
      status: 405,
      headers: responseHeaders({
        Allow: 'POST, OPTIONS',
        'Accept-Post': 'application/json',
      }),
    }
  );
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      },
      {
        status: 400,
        headers: responseHeaders(),
      }
    );
  }

  const requestedProtocolVersion = request.headers.get('mcp-protocol-version');
  const method = getRequestMethod(payload);
  if (method !== 'initialize' && !isSupportedMcpProtocolVersion(requestedProtocolVersion)) {
    return json(
      {
        jsonrpc: '2.0',
        id: getRequestId(payload),
        error: {
          code: -32600,
          message: 'Unsupported MCP-Protocol-Version',
        },
      },
      {
        status: 400,
        headers: responseHeaders(),
      }
    );
  }

  const result = await handleMcpRequest(
    {
      db: platform?.env?.DB,
      r2: platform?.env?.R2,
      githubToken: getGitHubRequestAuthFromEnv(platform?.env).token as string | undefined,
      githubRateLimitKV: platform?.env?.KV,
      request,
      locals,
      waitUntil: platform?.context?.waitUntil?.bind(platform.context),
    },
    payload
  );

  if (!result.body) {
    return new Response(null, {
      status: result.status,
      headers: responseHeaders(),
    });
  }

  return json(result.body, {
    status: result.status,
    headers: responseHeaders(),
  });
};

export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    headers: responseHeaders({
      Allow: 'POST, OPTIONS',
      'Accept-Post': 'application/json',
    }),
  });
};
