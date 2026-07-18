import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedBinary: vi.fn(),
  resolveSkillSourceInfo: vi.fn(),
  buildSkillMetricMessage: vi.fn(),
  enqueueSkillMetric: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  getCachedBinary: mocks.getCachedBinary,
}));

vi.mock('../src/lib/server/cache/keys', () => ({
  getPublicSkillDownloadCacheKey: (slug: string, updatedAt: number) => `download:${slug}:${updatedAt}`,
}));

vi.mock('../src/lib/server/skill/source', () => ({
  resolveSkillSourceInfo: mocks.resolveSkillSourceInfo,
}));

vi.mock('../src/lib/server/skill/metrics', () => ({
  buildSkillMetricMessage: mocks.buildSkillMetricMessage,
  enqueueSkillMetric: mocks.enqueueSkillMetric,
}));

const privateSkill = {
  id: 'skill-private',
  name: 'Private Skill',
  slug: 'acme/private-skill',
  source_type: 'upload',
  repo_owner: null,
  repo_name: null,
  skill_path: null,
  readme: '# Private fallback',
  visibility: 'private' as const,
  updated_at: 123,
};

function platform(content = '# Private archive') {
  const get = vi.fn(async () => ({ text: async () => content }));
  return {
    get,
    value: {
      env: {
        DB: {} as D1Database,
        R2: { get } as unknown as R2Bucket,
      },
      context: { waitUntil: vi.fn() },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSkillSourceInfo.mockResolvedValue({
    skill: privateSkill,
    cacheControl: 'private, no-cache',
    cacheStatus: 'BYPASS',
    status: 200,
  });
  mocks.buildSkillMetricMessage.mockReturnValue({ metric: 'download' });
  mocks.enqueueSkillMetric.mockReturnValue(true);
  mocks.getCachedBinary.mockImplementation(async (_key: string, load: () => Promise<Uint8Array>) => ({
    data: await load(),
    hit: false,
  }));
});

describe('private skill download route', () => {
  it.each([
    [401, 'Authentication required'],
    [403, 'You do not have permission to access this skill'],
  ])('preserves protected download status %s before reading R2 or recording metrics', async (status, message) => {
    mocks.resolveSkillSourceInfo.mockResolvedValueOnce({
      skill: null,
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      error: message,
      status,
    });
    const storage = platform();
    const { GET } = await import('../src/routes/api/skills/[slug]/download/+server');

    await expect(GET({
      params: { slug: 'acme/private-skill' },
      platform: storage.value,
      request: new Request('https://skills.cat/api/skills/acme%2Fprivate-skill/download'),
      locals: {},
    } as never)).rejects.toMatchObject({ status });

    expect(storage.get).not.toHaveBeenCalled();
    expect(mocks.enqueueSkillMetric).not.toHaveBeenCalled();
  });

  it('serves an authorized private archive without shared binary caching', async () => {
    const storage = platform('# Private archive');
    const { GET } = await import('../src/routes/api/skills/[slug]/download/+server');
    const response = await GET({
      params: { slug: 'acme/private-skill' },
      platform: storage.value,
      request: new Request('https://skills.cat/api/skills/acme%2Fprivate-skill/download', {
        headers: { Authorization: 'Bearer sk_org_token' },
      }),
      locals: {},
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
    expect(response.headers.get('content-disposition')).toContain('private-skill.zip');
    expect(mocks.getCachedBinary).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(await response.arrayBuffer())).toContain('# Private archive');
    expect(mocks.enqueueSkillMetric).toHaveBeenCalledTimes(1);
  });

  it('uses the versioned binary cache only for public downloads', async () => {
    mocks.resolveSkillSourceInfo.mockResolvedValueOnce({
      skill: { ...privateSkill, id: 'skill-public', visibility: 'public' },
      cacheControl: 'public, max-age=300',
      cacheStatus: 'MISS',
      status: 200,
    });
    mocks.getCachedBinary.mockResolvedValueOnce({
      data: new Uint8Array([1, 2, 3]),
      hit: true,
    });
    const storage = platform();
    const { GET } = await import('../src/routes/api/skills/[slug]/download/+server');
    const response = await GET({
      params: { slug: 'acme/private-skill' },
      platform: storage.value,
      request: new Request('https://skills.cat/api/skills/acme%2Fprivate-skill/download'),
      locals: {},
    } as never);

    expect(mocks.getCachedBinary).toHaveBeenCalledWith(
      'download:acme/private-skill:123',
      expect.any(Function),
      3600,
      expect.objectContaining({ contentType: 'application/zip' })
    );
    expect(response.headers.get('x-cache')).toBe('HIT');
  });
});
