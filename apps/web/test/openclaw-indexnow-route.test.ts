import { afterEach, describe, expect, it, vi } from 'vitest';

interface DbCall {
  sql: string;
  bindings: unknown[];
}

function createMutationDb() {
  const calls: DbCall[] = [];
  const skill = {
    id: 'skill-1',
    slug: 'acme/demo-skill',
    sourceType: 'upload',
    orgSlug: null,
  };

  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), bindings });
          return {
            first: async () => skill,
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          };
        },
      };
    },
  };
}

function mockMutationDependencies(indexNow: {
  buildIndexNowSkillRemovalUrls: ReturnType<typeof vi.fn>;
  buildIndexNowSkillUrls: ReturnType<typeof vi.fn>;
  loadIndexNowSkillTarget: ReturnType<typeof vi.fn>;
  scheduleIndexNowSubmission: ReturnType<typeof vi.fn>;
}, manifest: Record<string, unknown> | null = {
  schemaVersion: 1,
  compatSlug: 'acme~demo-skill',
  nativeSlug: 'acme/demo-skill',
  ownerHandle: 'acme',
  createdAt: 1,
  updatedAt: 1,
  deleted: true,
  deletedAt: 1,
  tags: { latest: '1.0.0' },
  versions: [],
}) {
  vi.doMock('$lib/server/auth/middleware', () => ({
    getAuthContext: async () => ({ userId: 'user-1', orgId: null }),
    requireScope: vi.fn(),
    requireSubmitPublishScope: vi.fn(),
  }));
  vi.doMock('$lib/server/auth/permissions', () => ({
    canWriteSkill: async () => true,
  }));
  vi.doMock('$lib/server/openclaw/cache', async (importOriginal) => ({
    ...await importOriginal<typeof import('../src/lib/server/openclaw/cache')>(),
    invalidateOpenClawSkillCaches: vi.fn(async () => undefined),
  }));
  vi.doMock('$lib/server/openclaw/compat-store', () => ({
    acquireOpenClawPublishLock: vi.fn(async () => ({ key: 'lock', id: 'lock-1', etag: 'etag-1' })),
    readOpenClawManifest: vi.fn(async () => manifest),
    releaseOpenClawPublishLock: vi.fn(async () => undefined),
    writeOpenClawManifest: vi.fn(async () => undefined),
  }));
  vi.doMock('$lib/server/cache/categories', () => ({
    invalidateCategoryCaches: vi.fn(async () => undefined),
  }));
  vi.doMock('$lib/server/db/business/stats', () => ({
    syncCategoryPublicStats: vi.fn(async () => undefined),
  }));
  vi.doMock('$lib/server/seo/indexnow', () => indexNow);
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('OpenClaw IndexNow mutation routes', () => {
  it('notifies deletion for the historical public URLs', async () => {
    const target = {
      slug: 'acme/demo-skill',
      visibility: 'public',
      seoIndexable: false,
      orgSlug: null,
      ownerHandle: 'acme',
    };
    const buildIndexNowSkillRemovalUrls = vi.fn(() => ['https://skills.cat/skills/acme/demo-skill']);
    const scheduleIndexNowSubmission = vi.fn();
    const indexNow = {
      buildIndexNowSkillRemovalUrls,
      buildIndexNowSkillUrls: vi.fn(),
      loadIndexNowSkillTarget: vi.fn(async () => target),
      scheduleIndexNowSubmission,
    };
    mockMutationDependencies(indexNow);

    const db = createMutationDb();
    const waitUntil = vi.fn();
    const { DELETE } = await import('../src/routes/openclaw/api/v1/skills/[slug]/+server');
    const response = await DELETE({
      params: { slug: 'acme~demo-skill' },
      platform: { env: { DB: db, R2: {} }, context: { waitUntil } },
      request: new Request('https://skills.cat/openclaw/api/v1/skills/acme~demo-skill', { method: 'DELETE' }),
      locals: {},
    } as never);

    expect(response.status).toBe(200);
    expect(buildIndexNowSkillRemovalUrls).toHaveBeenCalledWith(target, expect.any(Object));
    expect(scheduleIndexNowSubmission).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delete',
      source: 'openclaw-delete:acme/demo-skill',
      urls: ['https://skills.cat/skills/acme/demo-skill'],
    }));
  });

  it('refreshes indexed_at and notifies restoration as an update', async () => {
    const target = {
      slug: 'acme/demo-skill',
      visibility: 'public',
      seoIndexable: true,
      orgSlug: null,
      ownerHandle: 'acme',
    };
    const buildIndexNowSkillUrls = vi.fn(() => ['https://skills.cat/skills/acme/demo-skill']);
    const scheduleIndexNowSubmission = vi.fn();
    const indexNow = {
      buildIndexNowSkillRemovalUrls: vi.fn(),
      buildIndexNowSkillUrls,
      loadIndexNowSkillTarget: vi.fn(async () => target),
      scheduleIndexNowSubmission,
    };
    mockMutationDependencies(indexNow);

    const db = createMutationDb();
    const waitUntil = vi.fn();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/[slug]/undelete/+server');
    const response = await POST({
      params: { slug: 'acme~demo-skill' },
      platform: { env: { DB: db, R2: {} }, context: { waitUntil } },
      request: new Request('https://skills.cat/openclaw/api/v1/skills/acme~demo-skill/undelete', { method: 'POST' }),
      locals: {},
    } as never);

    expect(response.status).toBe(200);
    expect(db.calls.some((call) => (
      call.sql.includes("SET visibility = 'public', updated_at = ?, indexed_at = ?")
      && call.bindings.length === 3
    ))).toBe(true);
    expect(buildIndexNowSkillUrls).toHaveBeenCalledWith(target, expect.any(Object));
    expect(scheduleIndexNowSubmission).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      source: 'openclaw-undelete:acme/demo-skill',
      urls: ['https://skills.cat/skills/acme/demo-skill'],
    }));
  });

  it('does not expose a regular private upload through undelete', async () => {
    const indexNow = {
      buildIndexNowSkillRemovalUrls: vi.fn(),
      buildIndexNowSkillUrls: vi.fn(),
      loadIndexNowSkillTarget: vi.fn(),
      scheduleIndexNowSubmission: vi.fn(),
    };
    mockMutationDependencies(indexNow, null);

    const db = createMutationDb();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/[slug]/undelete/+server');

    await expect(POST({
      params: { slug: 'acme~demo-skill' },
      platform: { env: { DB: db, R2: {} } },
      request: new Request('https://skills.cat/openclaw/api/v1/skills/acme~demo-skill/undelete', { method: 'POST' }),
      locals: {},
    } as never)).rejects.toMatchObject({ status: 409 });

    expect(db.calls.some((call) => call.sql.includes("SET visibility = 'public'"))).toBe(false);
  });
});
