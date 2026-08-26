import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  getCachedText: vi.fn(),
}));

vi.mock('$lib/server/cache', () => cacheMocks);

import {
  AGENT_SKILLS_DISCOVERY_SCHEMA,
  buildAgentSkillsDiscoveryIndex,
  computeSha256Digest,
  isValidAgentSkillName,
  resolveAgentSkillArtifact,
  resolveAgentSkillsDiscoveryIndex,
} from '../src/lib/server/agent/skills-discovery';
import {
  AGENT_SKILLS_DISCOVERY_INDEX_CACHE_KEY,
  getSkillPageCacheInvalidationKeys,
  PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
} from '../src/lib/server/cache/keys';

const SKILL_MD = `---
name: demo-skill
description: Demonstrates the discovery endpoint.
---

# Demo
`;

interface ArtifactRow {
  id: string;
  slug: string;
  name: string;
  sourceType: string;
  repoOwner: string | null;
  repoName: string | null;
  skillPath: string | null;
  contentHash: string | null;
}

function createDb(input: {
  discoveryRows?: Array<{
    slug: string;
    name: string;
    description: string | null;
    contentHash: string | null;
  }>;
  artifactRow?: ArtifactRow | null;
  fallbackReadme?: string | null;
}) {
  const queries: string[] = [];
  const prepare = vi.fn((query: string) => {
    const normalized = query.replace(/\s+/g, ' ').trim();
    queries.push(normalized);

    if (normalized.includes('ORDER BY slug ASC')) {
      return {
        all: vi.fn(async () => ({ results: input.discoveryRows || [] })),
      };
    }

    return {
      bind: vi.fn(() => ({
        first: vi.fn(async () => (
          normalized.includes('SELECT readme')
            ? { readme: input.fallbackReadme ?? null }
            : input.artifactRow ?? null
        )),
      })),
    };
  });

  return {
    db: { prepare } as unknown as D1Database,
    queries,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cacheMocks.getCached.mockImplementation(async (
    _key: string,
    load: () => Promise<unknown>
  ) => ({ data: await load(), hit: false }));
  cacheMocks.getCachedText.mockImplementation(async (
    _key: string,
    load: () => Promise<string>
  ) => ({ data: await load(), hit: false }));
});

describe('Agent Skills discovery index', () => {
  it('builds v0.2.0 entries and filters records that cannot satisfy the RFC', () => {
    const hash = 'a'.repeat(64);
    const index = buildAgentSkillsDiscoveryIndex([
      {
        slug: 'acme/demo-skill',
        name: 'demo-skill',
        description: '  Discover\nuseful   skills.  ',
        contentHash: hash.toUpperCase(),
      },
      {
        slug: 'acme/invalid-name',
        name: 'Invalid Name',
        description: 'Invalid identifier.',
        contentHash: hash,
      },
      {
        slug: 'acme/missing-description',
        name: 'missing-description',
        description: null,
        contentHash: hash,
      },
      {
        slug: 'acme/missing-hash',
        name: 'missing-hash',
        description: 'No verifiable artifact.',
        contentHash: null,
      },
    ]);

    expect(index).toEqual({
      $schema: AGENT_SKILLS_DISCOVERY_SCHEMA,
      skills: [{
        name: 'demo-skill',
        type: 'skill-md',
        description: 'Discover useful skills.',
        url: `/.well-known/agent-skills/artifacts/SKILL.md?slug=acme%2Fdemo-skill&digest=sha256%3A${hash}`,
        digest: `sha256:${hash}`,
      }],
    });
  });

  it.each([
    ['a', true],
    ['code-review', true],
    ['skill-2', true],
    ['', false],
    ['Code-review', false],
    ['code_review', false],
    ['-code-review', false],
    ['code-review-', false],
    ['code--review', false],
    ['a'.repeat(65), false],
  ])('validates Agent Skills name %j', (name, expected) => {
    expect(isValidAgentSkillName(name)).toBe(expected);
  });

  it('queries only public non-archived metadata and uses the discovery cache key', async () => {
    const hash = 'b'.repeat(64);
    const storage = createDb({
      discoveryRows: [{
        slug: 'acme/demo-skill',
        name: 'demo-skill',
        description: 'Demo.',
        contentHash: hash,
      }],
    });

    const resolved = await resolveAgentSkillsDiscoveryIndex({ db: storage.db });

    expect(resolved.status).toBe(200);
    expect(resolved.data?.skills).toHaveLength(1);
    expect(cacheMocks.getCached).toHaveBeenCalledWith(
      AGENT_SKILLS_DISCOVERY_INDEX_CACHE_KEY,
      expect.any(Function),
      60,
      expect.any(Object)
    );
    expect(storage.queries[0]).toContain("WHERE visibility = 'public'");
    expect(storage.queries[0]).toContain("tier != 'archived'");
    expect(storage.queries[0]).not.toContain('SELECT *');
  });

  it('includes the index in existing public discovery invalidation flows', () => {
    expect(PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS)
      .toContain(AGENT_SKILLS_DISCOVERY_INDEX_CACHE_KEY);
    expect(getSkillPageCacheInvalidationKeys('acme/demo-skill'))
      .toContain(AGENT_SKILLS_DISCOVERY_INDEX_CACHE_KEY);
  });

  it('serves the required JSON route with GET and HEAD support', async () => {
    const hash = 'c'.repeat(64);
    const storage = createDb({
      discoveryRows: [{
        slug: 'acme/demo-skill',
        name: 'demo-skill',
        description: 'Demo.',
        contentHash: hash,
      }],
    });
    const route = await import('../src/routes/.well-known/agent-skills/index.json/+server');
    const event = {
      platform: { env: { DB: storage.db }, context: {} },
    } as never;

    const response = await route.GET(event);
    const payload = await response.json() as {
      $schema: string;
      skills: Array<{ digest: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(payload.$schema).toBe(AGENT_SKILLS_DISCOVERY_SCHEMA);
    expect(payload.skills[0].digest).toBe(`sha256:${hash}`);
    const head = await route.HEAD(event);
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });
});

describe('Agent Skills artifact', () => {
  it('serves raw Markdown whose bytes match the advertised digest', async () => {
    const digest = await computeSha256Digest(SKILL_MD);
    const hash = digest.slice('sha256:'.length);
    const storage = createDb({
      artifactRow: {
        id: 'skill-1',
        slug: 'acme/demo-skill',
        name: 'demo-skill',
        sourceType: 'github',
        repoOwner: 'acme',
        repoName: 'skills',
        skillPath: null,
        contentHash: hash,
      },
    });
    const get = vi.fn(async (key: string) => (
      key === 'skills/github/acme/skills/_root_/SKILL.md'
        ? { text: async () => SKILL_MD }
        : null
    ));

    const resolved = await resolveAgentSkillArtifact({
      db: storage.db,
      r2: { get } as unknown as R2Bucket,
      slug: 'acme/demo-skill',
      digest,
    });

    expect(resolved).toMatchObject({
      content: SKILL_MD,
      status: 200,
      cacheStatus: 'MISS',
      digest,
    });
    expect(await computeSha256Digest(resolved.content || '')).toBe(digest);
    expect(get).toHaveBeenCalledWith('skills/github/acme/skills/_root_/SKILL.md');
    expect(storage.queries[0]).toContain("visibility = 'public'");
    expect(storage.queries[0]).toContain("tier != 'archived'");
  });

  it('returns Markdown with the RFC-required HTTP behavior', async () => {
    const digest = await computeSha256Digest(SKILL_MD);
    const storage = createDb({
      artifactRow: {
        id: 'skill-upload',
        slug: 'acme/demo-skill',
        name: 'demo-skill',
        sourceType: 'upload',
        repoOwner: null,
        repoName: null,
        skillPath: null,
        contentHash: digest.slice('sha256:'.length),
      },
    });
    const route = await import(
      '../src/routes/.well-known/agent-skills/artifacts/SKILL.md/+server'
    );
    const response = await route.GET({
      platform: {
        env: {
          DB: storage.db,
          R2: { get: vi.fn(async () => ({ text: async () => SKILL_MD })) },
        },
        context: {},
      },
      url: new URL(
        `https://skills.cat/.well-known/agent-skills/artifacts/SKILL.md?slug=acme%2Fdemo-skill&digest=${digest}`
      ),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    await expect(response.text()).resolves.toBe(SKILL_MD);
    const head = await route.HEAD({
      platform: {
        env: {
          DB: storage.db,
          R2: { get: vi.fn(() => {
            throw new Error('HEAD must not read artifact content');
          }) },
        },
      },
      url: new URL(
        `https://skills.cat/.well-known/agent-skills/artifacts/SKILL.md?slug=acme%2Fdemo-skill&digest=${digest}`
      ),
    } as never);
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });

  it('rejects stale URLs and content that does not match the indexed digest', async () => {
    const digest = await computeSha256Digest(SKILL_MD);
    const hash = digest.slice('sha256:'.length);
    const row: ArtifactRow = {
      id: 'skill-1',
      slug: 'acme/demo-skill',
      name: 'demo-skill',
      sourceType: 'upload',
      repoOwner: null,
      repoName: null,
      skillPath: null,
      contentHash: hash,
    };

    const stale = await resolveAgentSkillArtifact({
      db: createDb({ artifactRow: row }).db,
      r2: undefined,
      slug: row.slug,
      digest: `sha256:${'d'.repeat(64)}`,
    });
    expect(stale).toMatchObject({ status: 404, content: null });

    const mismatched = await resolveAgentSkillArtifact({
      db: createDb({ artifactRow: row }).db,
      r2: {
        get: vi.fn(async () => ({ text: async () => `${SKILL_MD}\nchanged` })),
      } as unknown as R2Bucket,
      slug: row.slug,
      digest,
    });
    expect(mismatched).toMatchObject({
      status: 503,
      content: null,
      error: 'Skill artifact digest mismatch',
    });
  });

  it('does not read R2 when the skill is not currently public', async () => {
    const get = vi.fn();
    const resolved = await resolveAgentSkillArtifact({
      db: createDb({ artifactRow: null }).db,
      r2: { get } as unknown as R2Bucket,
      slug: 'acme/private-skill',
      digest: `sha256:${'e'.repeat(64)}`,
    });

    expect(resolved).toMatchObject({ status: 404, content: null });
    expect(get).not.toHaveBeenCalled();
  });
});
