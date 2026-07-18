import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  getAuthContext: vi.fn(),
  requireSubmitPublishScope: vi.fn(),
  resolveOpenClawOwnerContext: vi.fn(),
  acquireOpenClawPublishLock: vi.fn(),
  releaseOpenClawPublishLock: vi.fn(),
  readOpenClawManifest: vi.fn(),
  readOpenClawCurrentFiles: vi.fn(),
  snapshotOpenClawVersionFiles: vi.fn(),
  replaceOpenClawCurrentFiles: vi.fn(),
  writeOpenClawManifest: vi.fn(),
  deleteOpenClawCurrentFiles: vi.fn(),
  deleteOpenClawManifest: vi.fn(),
  deleteOpenClawVersionFiles: vi.fn(),
  findSkillsByExactHashGroup: vi.fn(),
  invalidateOpenClawSkillCaches: vi.fn(),
  resolveOpenClawJsonCache: vi.fn(),
  resolveOpenClawVersionState: vi.fn(),
  getCurrentPublicSkillSlugs: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/lib/server/cache', () => ({
  invalidateCache: mocks.invalidateCache,
}));

vi.mock('../src/lib/server/auth/middleware', () => ({
  getAuthContext: mocks.getAuthContext,
  requireSubmitPublishScope: mocks.requireSubmitPublishScope,
}));

vi.mock('../src/lib/server/auth/permissions', () => ({
  canWriteSkill: vi.fn(async () => true),
}));

vi.mock('../src/lib/server/openclaw/identity', () => ({
  resolveOpenClawOwnerContext: mocks.resolveOpenClawOwnerContext,
}));

vi.mock('../src/lib/server/openclaw/compat-store', () => ({
  acquireOpenClawPublishLock: mocks.acquireOpenClawPublishLock,
  buildOpenClawFileTree: vi.fn(() => ({ fileTree: [] })),
  deleteOpenClawCurrentFiles: mocks.deleteOpenClawCurrentFiles,
  deleteOpenClawManifest: mocks.deleteOpenClawManifest,
  deleteOpenClawVersionFiles: mocks.deleteOpenClawVersionFiles,
  findOpenClawReadme: vi.fn((files: Array<{ path: string; content: string }>) => (
    files.find((file) => file.path.toLowerCase() === 'skill.md') || null
  )),
  readOpenClawCurrentFiles: mocks.readOpenClawCurrentFiles,
  readOpenClawManifest: mocks.readOpenClawManifest,
  releaseOpenClawPublishLock: mocks.releaseOpenClawPublishLock,
  replaceOpenClawCurrentFiles: mocks.replaceOpenClawCurrentFiles,
  snapshotOpenClawVersionFiles: mocks.snapshotOpenClawVersionFiles,
  writeOpenClawManifest: mocks.writeOpenClawManifest,
}));

vi.mock('../src/lib/server/openclaw/cache', () => ({
  buildOpenClawBrowseListCacheKey: vi.fn(() => 'openclaw:list'),
  canCacheOpenClawBrowseList: vi.fn(() => true),
  getOpenClawRouteCachePolicy: vi.fn(() => ({ cacheControl: 'public', ttlSeconds: 1 })),
  invalidateOpenClawSkillCaches: mocks.invalidateOpenClawSkillCaches,
  resolveOpenClawJsonCache: mocks.resolveOpenClawJsonCache,
}));

vi.mock('../src/lib/server/openclaw/skill-state', () => ({
  resolveOpenClawVersionState: mocks.resolveOpenClawVersionState,
}));

vi.mock('../src/lib/server/skill/visibility', () => ({
  getCurrentPublicSkillSlugs: mocks.getCurrentPublicSkillSlugs,
}));

vi.mock('../src/lib/server/skill/dedup', () => ({
  buildSkillHashStatements: vi.fn(() => [{ kind: 'hash-statement' }]),
  computeBundleManifestHash: vi.fn(async () => 'bundle-manifest-hash'),
  computeExactBundleFingerprint: vi.fn(async () => 'bundle-exact-hash'),
  computeSha256Hex: vi.fn(async () => 'file-hash'),
  computeSkillMdHashes: vi.fn(async () => ({
    fullHash: 'full-hash',
    normalizedHash: 'normalized-hash',
  })),
  findSkillsByExactHashGroup: mocks.findSkillsByExactHashGroup,
}));

vi.mock('../src/lib/server/openclaw/clawhub-compat', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/server/openclaw/clawhub-compat')>(),
  buildClawHubCompatFingerprint: vi.fn(async () => 'fingerprint'),
}));

interface TestDbOptions {
  batchError?: Error;
}

function createDb(options: TestDbOptions = {}) {
  const batch = vi.fn(async () => {
    mocks.events.push('db-batch');
    if (options.batchError) throw options.batchError;
    return [{ meta: { changes: 1 } }];
  });

  return {
    batch,
    prepare: vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        sql,
        bindings,
        first: async () => {
          if (sql.includes('FROM skills')) return null;
          throw new Error(`Unexpected first SQL: ${sql}`);
        },
      }),
    })),
  };
}

function publishRequest(fileCount = 1) {
  const form = new FormData();
  form.set('payload', JSON.stringify({
    slug: 'alice~demo',
    version: '1.0.0',
    acceptLicenseTerms: true,
  }));
  for (let index = 0; index < fileCount; index += 1) {
    const name = index === 0 ? 'SKILL.md' : `docs/file-${index}.md`;
    form.append('files', new File([index === 0 ? '# Demo\n\nA useful skill.' : 'content'], name));
  }
  return new Request('https://skills.cat/openclaw/api/v1/skills', {
    method: 'POST',
    body: form,
  });
}

beforeEach(() => {
  mocks.events.length = 0;
  mocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    orgId: null,
    principalId: 'user-1',
    scopes: ['publish'],
  });
  mocks.resolveOpenClawOwnerContext.mockResolvedValue({
    ownerHandle: 'alice',
    orgId: null,
    orgVerifiedWithGithub: false,
  });
  mocks.acquireOpenClawPublishLock.mockResolvedValue({ key: 'lock', id: 'lock-1', etag: 'etag-1' });
  mocks.releaseOpenClawPublishLock.mockImplementation(async () => {
    mocks.events.push('release-lock');
  });
  mocks.readOpenClawManifest.mockResolvedValue(null);
  mocks.readOpenClawCurrentFiles.mockResolvedValue([]);
  mocks.snapshotOpenClawVersionFiles.mockImplementation(async () => {
    mocks.events.push('snapshot');
  });
  mocks.replaceOpenClawCurrentFiles.mockImplementation(async () => {
    mocks.events.push('current');
  });
  mocks.writeOpenClawManifest.mockImplementation(async () => {
    mocks.events.push('manifest');
  });
  mocks.deleteOpenClawCurrentFiles.mockImplementation(async () => {
    mocks.events.push('rollback-current');
  });
  mocks.deleteOpenClawManifest.mockImplementation(async () => {
    mocks.events.push('rollback-manifest');
  });
  mocks.deleteOpenClawVersionFiles.mockImplementation(async () => {
    mocks.events.push('rollback-version');
  });
  mocks.findSkillsByExactHashGroup.mockResolvedValue([]);
  mocks.invalidateOpenClawSkillCaches.mockResolvedValue(undefined);
  mocks.invalidateCache.mockResolvedValue(undefined);
  mocks.getCurrentPublicSkillSlugs.mockResolvedValue(new Set());
  mocks.resolveOpenClawJsonCache.mockImplementation(async ({ load }) => ({
    data: await load(),
    headers: {},
  }));
  mocks.resolveOpenClawVersionState.mockImplementation(async ({ updatedAt }) => ({
    manifest: null,
    latestVersion: {
      version: '0.0.1',
      createdAt: updatedAt,
      changelog: 'Synced',
      changelogSource: 'auto',
      license: null,
    },
    tags: { latest: '0.0.1' },
    versions: [{ version: '0.0.1' }],
    selectedVersion: null,
    usesManifest: false,
  }));
});

describe('OpenClaw browse cache', () => {
  it('refetches a cached page when a listed skill is no longer public', async () => {
    mocks.resolveOpenClawJsonCache
      .mockResolvedValueOnce({
        data: {
          items: [{ slug: 'alice~private-now' }],
          nextCursor: null,
        },
        cacheStatus: 'HIT',
        headers: { 'X-Cache': 'HIT' },
      })
      .mockResolvedValueOnce({
        data: { items: [], nextCursor: null },
        cacheStatus: 'MISS',
        headers: { 'X-Cache': 'MISS' },
      });

    const { GET } = await import('../src/routes/openclaw/api/v1/skills/+server');
    const response = await GET({
      url: new URL('https://skills.cat/openclaw/api/v1/skills'),
      platform: {
        env: { DB: {} },
        context: { waitUntil: vi.fn() },
      },
    } as never);

    await expect(response.json()).resolves.toEqual({ items: [], nextCursor: null });
    expect(mocks.getCurrentPublicSkillSlugs).toHaveBeenCalledWith(
      expect.anything(),
      ['alice/private-now']
    );
    expect(mocks.invalidateCache).toHaveBeenCalledWith('openclaw:list');
    expect(response.headers.get('x-cache')).toBe('MISS');
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OpenClaw publish route', () => {
  it('skips R2 manifest reads for GitHub-backed browse results', async () => {
    const r2 = { get: vi.fn() };
    const rows = [
      {
        id: 'github-1',
        name: 'GitHub Skill',
        slug: 'alice/github-skill',
        description: null,
        stars: 0,
        downloadCount30d: 0,
        downloadCount90d: 0,
        sourceType: 'github',
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'upload-1',
        name: 'Upload Skill',
        slug: 'alice/upload-skill',
        description: null,
        stars: 0,
        downloadCount30d: 0,
        downloadCount90d: 0,
        sourceType: 'upload',
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: rows })) })),
      })),
    };
    const { GET } = await import('../src/routes/openclaw/api/v1/skills/+server');

    const response = await GET({
      url: new URL('https://skills.cat/openclaw/api/v1/skills?limit=25'),
      platform: { env: { DB: db, R2: r2 }, context: { waitUntil: vi.fn() } },
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.resolveOpenClawVersionState).toHaveBeenCalledTimes(2);
    expect(mocks.resolveOpenClawVersionState.mock.calls[0]?.[0]?.r2).toBeUndefined();
    expect(mocks.resolveOpenClawVersionState.mock.calls[1]?.[0]?.r2).toBe(r2);
  });

  it('writes R2 artifacts before committing the D1 batch', async () => {
    const db = createDb();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/+server');

    const response = await POST({
      request: publishRequest(),
      platform: { env: { DB: db, R2: {} } },
      locals: {},
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.events).toEqual([
      'snapshot',
      'current',
      'manifest',
      'db-batch',
      'release-lock',
    ]);
  });

  it('advances the organization snapshot marker in the atomic publish batch', async () => {
    mocks.resolveOpenClawOwnerContext.mockResolvedValueOnce({
      ownerHandle: 'alice',
      orgId: 'org-1',
      orgVerifiedWithGithub: true,
    });
    const db = createDb();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/+server');

    const response = await POST({
      request: publishRequest(),
      platform: { env: { DB: db, R2: {} } },
      locals: {},
    } as never);

    expect(response.status).toBe(200);
    const statements = db.batch.mock.calls[0]?.[0] as Array<{
      sql?: string;
      bindings?: unknown[];
    }>;
    expect(statements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sql: expect.stringContaining('UPDATE organizations'),
        bindings: expect.arrayContaining(['org-1']),
      }),
    ]));
  });

  it('extracts the published summary from the markdown body after frontmatter', async () => {
    const form = new FormData();
    form.set('payload', JSON.stringify({
      slug: 'alice~demo',
      version: '1.0.0',
      acceptLicenseTerms: true,
    }));
    form.append('files', new File([
      '---\nname: Demo\ndescription: Frontmatter description.\n---\n\n# Demo\n\nBody summary.\n',
    ], 'SKILL.md'));
    const db = createDb();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/+server');

    await POST({
      request: new Request('https://skills.cat/openclaw/api/v1/skills', {
        method: 'POST',
        body: form,
      }),
      platform: { env: { DB: db, R2: {} } },
      locals: {},
    } as never);

    const skillStatement = db.batch.mock.calls[0]?.[0]?.[0] as { bindings?: unknown[] } | undefined;
    expect(skillStatement?.bindings?.[3]).toBe('Body summary.');
  });

  it('does not touch D1 and compensates when an R2 write fails', async () => {
    mocks.snapshotOpenClawVersionFiles.mockImplementationOnce(async () => {
      mocks.events.push('snapshot');
      throw new Error('R2 failed');
    });
    const db = createDb();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/+server');

    await expect(POST({
      request: publishRequest(),
      platform: { env: { DB: db, R2: {} } },
      locals: {},
    } as never)).rejects.toMatchObject({ status: 500 });

    expect(db.batch).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(expect.arrayContaining([
      'rollback-current',
      'rollback-manifest',
      'rollback-version',
      'release-lock',
    ]));
  });

  it('compensates R2 artifacts when the atomic D1 batch fails', async () => {
    const db = createDb({ batchError: new Error('D1 failed') });
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/+server');

    await expect(POST({
      request: publishRequest(),
      platform: { env: { DB: db, R2: {} } },
      locals: {},
    } as never)).rejects.toMatchObject({ status: 500 });

    expect(mocks.events).toEqual(expect.arrayContaining([
      'db-batch',
      'rollback-current',
      'rollback-manifest',
      'rollback-version',
      'release-lock',
    ]));
  });

  it('rejects an unverified organization before acquiring the publish lock', async () => {
    mocks.resolveOpenClawOwnerContext.mockResolvedValueOnce({
      ownerHandle: 'acme',
      orgId: 'org-1',
      orgVerifiedWithGithub: false,
    });
    const db = createDb();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/+server');

    await expect(POST({
      request: publishRequest(),
      platform: { env: { DB: db, R2: {} } },
      locals: {},
    } as never)).rejects.toMatchObject({ status: 403 });

    expect(mocks.acquireOpenClawPublishLock).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('rejects unbounded file fan-out', async () => {
    const db = createDb();
    const { POST } = await import('../src/routes/openclaw/api/v1/skills/+server');

    await expect(POST({
      request: publishRequest(129),
      platform: { env: { DB: db, R2: {} } },
      locals: {},
    } as never)).rejects.toMatchObject({ status: 413 });

    expect(mocks.acquireOpenClawPublishLock).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });
});
