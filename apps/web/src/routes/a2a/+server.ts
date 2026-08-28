import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  parseRegistrySearchInput,
  resolveRegistrySearch,
  type RegistrySkillItem,
} from '$lib/server/registry/search';

const SEARCH_RESULT_LIMIT = 5;

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_METHOD_NOT_FOUND = -32601;

function rpcHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  method?: unknown;
  params?: unknown;
  id?: unknown;
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): Response {
  return json(
    {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    },
    { headers: rpcHeaders() }
  );
}

function jsonRpcResult(id: JsonRpcId, result: unknown): Response {
  return json(
    {
      jsonrpc: '2.0',
      id,
      result,
    },
    { headers: rpcHeaders() }
  );
}

function agentTextMessage(text: string) {
  return {
    kind: 'message',
    messageId: crypto.randomUUID(),
    role: 'agent',
    parts: [{ kind: 'text', text }],
  };
}

function extractQueryText(requestBody: JsonRpcRequest): string {
  const params = requestBody.params;
  if (!params || typeof params !== 'object') {
    return '';
  }

  const message = (params as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    return '';
  }

  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }
      const candidate = part as { kind?: unknown; text?: unknown };
      return candidate.kind === 'text' && typeof candidate.text === 'string'
        ? candidate.text
        : '';
    })
    .filter((text) => text.length > 0)
    .join('\n')
    .trim();
}

function renderSearchResults(query: string, skills: RegistrySkillItem[], total: number): string {
  if (skills.length === 0) {
    return query
      ? `No skills found for "${query}". Try a broader query or browse https://skills.cat/categories.`
      : 'No skills available right now. Browse https://skills.cat/categories for ideas.';
  }

  const header = query
    ? `Found ${total} skill(s) for "${query}". Top matches:`
    : `Found ${total} skill(s). Top matches:`;
  const lines = skills.map((skill) => {
    const summary = skill.description || 'No description available.';
    return `- ${skill.name} (${skill.slug}) — ${summary} — Install: npx skillscat add ${skill.slug}`;
  });

  return [header, ...lines].join('\n');
}

async function handleMessageSend(
  id: JsonRpcId,
  requestBody: JsonRpcRequest,
  event: Parameters<RequestHandler>[0]
): Promise<Response> {
  const query = extractQueryText(requestBody);
  const db = event.platform?.env?.DB;

  if (!db) {
    return jsonRpcResult(
      id,
      agentTextMessage('Skill search is temporarily unavailable. Please try again later.')
    );
  }

  const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
  const input = parseRegistrySearchInput({ query, limit: SEARCH_RESULT_LIMIT });

  try {
    const resolved = await resolveRegistrySearch(
      { db, request: event.request, locals: event.locals, waitUntil },
      input
    );
    return jsonRpcResult(
      id,
      agentTextMessage(renderSearchResults(query, resolved.data.skills, resolved.data.total))
    );
  } catch (err) {
    console.error('Error handling A2A message/send:', err);
    return jsonRpcResult(
      id,
      agentTextMessage('Skill search failed due to an internal error. Please try again later.')
    );
  }
}

export const POST: RequestHandler = async (event) => {
  let requestBody: JsonRpcRequest;

  try {
    requestBody = await event.request.json() as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'Parse error: request body is not valid JSON');
  }

  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'Parse error: request body must be a JSON-RPC object');
  }

  const hasId = typeof requestBody.id === 'string' || typeof requestBody.id === 'number';
  const id: JsonRpcId = hasId ? requestBody.id as string | number : null;

  // JSON-RPC notifications (requests without an id) must not produce a response body.
  if (!hasId) {
    return new Response(null, { status: 204, headers: rpcHeaders() });
  }

  if (requestBody.method !== 'message/send') {
    return jsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${String(requestBody.method ?? '')}`);
  }

  return handleMessageSend(id, requestBody, event);
};

export const GET: RequestHandler = async () => {
  return json(
    { error: 'Method Not Allowed. Use POST with a JSON-RPC 2.0 payload.' },
    {
      status: 405,
      headers: {
        ...rpcHeaders(),
        Allow: 'POST',
      },
    }
  );
};

export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    headers: {
      ...rpcHeaders(),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
};
