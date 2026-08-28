import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistrySkillItem } from '../src/lib/server/registry/search';

const resolveRegistrySearch = vi.fn();

vi.mock('$lib/server/registry/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/server/registry/search')>();
  return {
    ...actual,
    resolveRegistrySearch,
  };
});

function buildSkill(overrides: Partial<RegistrySkillItem> = {}): RegistrySkillItem {
  return {
    id: 'skill-1',
    name: 'Code Review Pro',
    description: 'Reviews pull requests automatically.',
    owner: 'acme',
    repo: 'code-review-pro',
    stars: 42,
    updatedAt: 1712345678,
    categories: ['productivity'],
    platform: 'github',
    visibility: 'public',
    slug: 'acme/code-review-pro',
    ...overrides,
  };
}

function createPostEvent(body: string, options: { withDb?: boolean } = {}) {
  return {
    request: new Request('https://skills.cat/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    platform: options.withDb === false
      ? { env: {}, context: { waitUntil: vi.fn() } }
      : { env: { DB: {} }, context: { waitUntil: vi.fn() } },
    locals: {},
  } as never;
}

function messageSendPayload(queryText: string, id: string | number = 'req-1') {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: 'client-msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: queryText }],
      },
    },
  });
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

beforeEach(() => {
  resolveRegistrySearch.mockReset();
});

describe('A2A JSON-RPC endpoint', () => {
  it('answers message/send with an agent message containing rendered search results', async () => {
    resolveRegistrySearch.mockResolvedValue({
      data: { skills: [buildSkill()], total: 1 },
      cacheControl: 'private, no-cache',
      cacheStatus: 'MISS',
    });

    const { POST } = await import('../src/routes/a2a/+server');
    const response = await POST(createPostEvent(messageSendPayload('code review')));
    const payload = await response.json() as {
      jsonrpc: string;
      id: string;
      result: {
        kind: string;
        role: string;
        messageId: string;
        parts: Array<{ kind: string; text: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(payload.jsonrpc).toBe('2.0');
    expect(payload.id).toBe('req-1');
    expect(payload.result.kind).toBe('message');
    expect(payload.result.role).toBe('agent');
    expect(payload.result.messageId).toBeTruthy();
    expect(payload.result.parts[0]?.kind).toBe('text');
    expect(payload.result.parts[0]?.text).toContain('Code Review Pro');
    expect(payload.result.parts[0]?.text).toContain('acme/code-review-pro');
    expect(payload.result.parts[0]?.text).toContain('npx skillscat add acme/code-review-pro');

    expect(resolveRegistrySearch).toHaveBeenCalledOnce();
    const [, input] = resolveRegistrySearch.mock.calls[0] as [unknown, { query: string; limit: number }];
    expect(input.query).toBe('code review');
    expect(input.limit).toBe(5);
  });

  it('joins multiple text parts into the search query', async () => {
    resolveRegistrySearch.mockResolvedValue({
      data: { skills: [], total: 0 },
      cacheControl: 'private, no-cache',
      cacheStatus: 'MISS',
    });

    const { POST } = await import('../src/routes/a2a/+server');
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          messageId: 'client-msg-2',
          role: 'user',
          parts: [
            { kind: 'text', text: 'browser' },
            { kind: 'file', data: 'ignored' },
            { kind: 'text', text: 'automation' },
          ],
        },
      },
    });

    const response = await POST(createPostEvent(body));
    const payload = await response.json() as { id: number; result: { parts: Array<{ text: string }> } };

    expect(payload.id).toBe(7);
    const [, input] = resolveRegistrySearch.mock.calls[0] as [unknown, { query: string }];
    expect(input.query).toBe('browser\nautomation');
    expect(payload.result.parts[0]?.text).toContain('No skills found');
  });

  it('returns -32601 for unknown methods', async () => {
    const { POST } = await import('../src/routes/a2a/+server');
    const response = await POST(createPostEvent(JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-unknown',
      method: 'tasks/get',
      params: {},
    })));
    const payload = await response.json() as {
      id: string;
      error: { code: number; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.id).toBe('req-unknown');
    expect(payload.error.code).toBe(-32601);
    expect(resolveRegistrySearch).not.toHaveBeenCalled();
  });

  it('returns -32700 when the body is not valid JSON', async () => {
    const { POST } = await import('../src/routes/a2a/+server');
    const response = await POST(createPostEvent('{not json'));
    const payload = await response.json() as {
      id: string | null;
      error: { code: number };
    };

    expect(response.status).toBe(200);
    expect(payload.id).toBeNull();
    expect(payload.error.code).toBe(-32700);
    expect(resolveRegistrySearch).not.toHaveBeenCalled();
  });

  it('returns 204 without a body for JSON-RPC notifications', async () => {
    const { POST } = await import('../src/routes/a2a/+server');
    const response = await POST(createPostEvent(JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: { message: { kind: 'message', messageId: 'm', role: 'user', parts: [] } },
    })));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(resolveRegistrySearch).not.toHaveBeenCalled();
  });

  it('replies with an agent error message instead of 500 when search fails', async () => {
    resolveRegistrySearch.mockRejectedValue(new Error('D1 unavailable'));

    const { POST } = await import('../src/routes/a2a/+server');
    const response = await POST(createPostEvent(messageSendPayload('anything')));
    const payload = await response.json() as {
      result: { role: string; parts: Array<{ text: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.result.role).toBe('agent');
    expect(payload.result.parts[0]?.text).toContain('internal error');
  });

  it('replies with an agent error message when the database binding is missing', async () => {
    const { POST } = await import('../src/routes/a2a/+server');
    const response = await POST(createPostEvent(messageSendPayload('anything'), { withDb: false }));
    const payload = await response.json() as {
      result: { role: string; parts: Array<{ text: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.result.role).toBe('agent');
    expect(payload.result.parts[0]?.text).toContain('temporarily unavailable');
    expect(resolveRegistrySearch).not.toHaveBeenCalled();
  });

  it('rejects GET with 405 and Allow: POST', async () => {
    const { GET } = await import('../src/routes/a2a/+server');
    const response = await GET({} as never);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers CORS preflight requests', async () => {
    const { OPTIONS } = await import('../src/routes/a2a/+server');
    const response = await OPTIONS({} as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
