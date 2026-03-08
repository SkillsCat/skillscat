import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('../src/lib/server/registry-search');
  vi.unmock('../src/lib/server/registry-repo');
  vi.unmock('../src/lib/server/skill-detail');
  vi.unmock('../src/lib/server/skill-files');
});

describe('mcp route', () => {
  it('initializes the SkillsCat MCP server', async () => {
    const { POST } = await import('../src/routes/mcp/+server');
    const response = await POST({
      platform: { env: {}, context: {} },
      request: new Request('https://skills.cat/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      }),
      locals: {},
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-protocol-version')).toBe('2025-06-18');
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'skillscat',
          title: 'SkillsCat MCP',
        },
      },
    });
  });

  it('lists MCP tools', async () => {
    const { POST } = await import('../src/routes/mcp/+server');
    const response = await POST({
      platform: { env: {}, context: {} },
      request: new Request('https://skills.cat/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
      }),
      locals: {},
    } as never);

    const payload = await response.json() as {
      result: { tools: Array<{ name: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.result.tools.map((tool) => tool.name)).toEqual([
      'search_skills',
      'resolve_repo_skills',
      'get_skill_detail',
      'get_skill_bundle',
    ]);
  });

  it('rejects unsupported MCP protocol versions on tool calls', async () => {
    const { POST } = await import('../src/routes/mcp/+server');
    const response = await POST({
      platform: { env: {}, context: {} },
      request: new Request('https://skills.cat/mcp', {
        method: 'POST',
        headers: {
          'MCP-Protocol-Version': '2099-01-01',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/list',
        }),
      }),
      locals: {},
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 99,
      error: {
        code: -32600,
        message: 'Unsupported MCP-Protocol-Version',
      },
    });
  });

  it('routes get_skill_bundle through the existing resolver with waitUntil', async () => {
    const waitUntil = vi.fn();
    const resolveSkillFiles = vi.fn(async () => ({
      data: {
        folderName: 'test-skill',
        files: [
          { path: 'SKILL.md', content: '# Test skill' },
          { path: 'prompts/template.txt', content: 'hello' },
        ],
      },
      cacheControl: 'public, max-age=300',
      cacheStatus: 'MISS' as const,
    }));

    vi.doMock('../src/lib/server/skill-files', () => ({
      parseSkillFilesInput: () => ({ slug: 'testowner/testrepo' }),
      resolveSkillFiles,
    }));

    const { POST } = await import('../src/routes/mcp/+server');
    const response = await POST({
      platform: { env: {}, context: { waitUntil } },
      request: new Request('https://skills.cat/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'get_skill_bundle',
            arguments: { slug: 'testowner/testrepo' },
          },
        }),
      }),
      locals: {},
    } as never);

    const payload = await response.json() as {
      result: {
        content: Array<{ text: string }>;
        structuredContent: {
          folderName: string;
          files: Array<{ path: string; content: string }>;
        };
      };
    };

    expect(resolveSkillFiles).toHaveBeenCalledWith(
      expect.objectContaining({ waitUntil: expect.any(Function) }),
      { slug: 'testowner/testrepo' }
    );
    expect(payload.result.content[0]?.text).toContain('Fetched 2 files');
    expect(payload.result.structuredContent.folderName).toBe('test-skill');
    expect(payload.result.structuredContent.files).toHaveLength(2);
  });

  it('returns tool errors for unknown MCP tools', async () => {
    const { POST } = await import('../src/routes/mcp/+server');
    const response = await POST({
      platform: { env: {}, context: {} },
      request: new Request('https://skills.cat/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'unknown_tool',
            arguments: {},
          },
        }),
      }),
      locals: {},
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      result: {
        isError: true,
        structuredContent: {
          error: 'Unknown tool: unknown_tool',
          status: 404,
        },
      },
    });
  });
});
