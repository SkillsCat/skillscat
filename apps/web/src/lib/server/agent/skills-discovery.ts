import { getCached, getCachedText } from '$lib/server/cache';
import { AGENT_SKILLS_DISCOVERY_INDEX_CACHE_KEY } from '$lib/server/cache/keys';
import {
  buildGithubSkillR2Keys,
  buildUploadSkillR2Key,
  normalizeSkillSlug,
} from '$lib/skill-path';

export const AGENT_SKILLS_DISCOVERY_SCHEMA =
  'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

const INDEX_CACHE_TTL_SECONDS = 60;
const ARTIFACT_CACHE_TTL_SECONDS = 24 * 60 * 60;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

type WaitUntilFn = (promise: Promise<unknown>) => void;

interface DiscoverySkillRow {
  slug: string;
  name: string;
  description: string | null;
  contentHash: string | null;
}

interface ArtifactSkillRow {
  id: string;
  slug: string;
  name: string;
  sourceType: string;
  repoOwner: string | null;
  repoName: string | null;
  skillPath: string | null;
  contentHash: string | null;
}

export interface AgentSkillsDiscoveryEntry {
  name: string;
  type: 'skill-md';
  description: string;
  url: string;
  digest: string;
}

export interface AgentSkillsDiscoveryIndex {
  $schema: typeof AGENT_SKILLS_DISCOVERY_SCHEMA;
  skills: AgentSkillsDiscoveryEntry[];
}

export interface ResolvedAgentSkillsDiscoveryIndex {
  data: AgentSkillsDiscoveryIndex | null;
  status: number;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  error?: string;
}

export interface ResolvedAgentSkillArtifact {
  content: string | null;
  status: number;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  digest?: string;
  error?: string;
}

export type ResolvedAgentSkillArtifactHead = Omit<ResolvedAgentSkillArtifact, 'content'>;

class ArtifactLoadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function isValidAgentSkillName(name: string): boolean {
  return name.length >= 1
    && name.length <= MAX_SKILL_NAME_LENGTH
    && SKILL_NAME_PATTERN.test(name);
}

function normalizeDescription(description: string | null): string | null {
  const normalized = String(description ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_DESCRIPTION_LENGTH);
}

function normalizeSha256(hash: string | null): string | null {
  const normalized = String(hash ?? '').trim().toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

function buildArtifactUrl(slug: string, digest: string): string {
  const params = new URLSearchParams({ slug, digest });
  return `/.well-known/agent-skills/artifacts/SKILL.md?${params.toString()}`;
}

export function buildAgentSkillsDiscoveryIndex(
  rows: DiscoverySkillRow[]
): AgentSkillsDiscoveryIndex {
  const skills = rows.flatMap((row): AgentSkillsDiscoveryEntry[] => {
    const name = String(row.name ?? '').trim();
    const description = normalizeDescription(row.description);
    const hash = normalizeSha256(row.contentHash);
    const slug = normalizeSkillSlug(row.slug);

    if (!slug || !isValidAgentSkillName(name) || !description || !hash) {
      return [];
    }

    const digest = `sha256:${hash}`;
    return [{
      name,
      type: 'skill-md',
      description,
      url: buildArtifactUrl(slug, digest),
      digest,
    }];
  });

  skills.sort((left, right) => (
    left.name.localeCompare(right.name) || left.url.localeCompare(right.url)
  ));

  return {
    $schema: AGENT_SKILLS_DISCOVERY_SCHEMA,
    skills,
  };
}

async function fetchDiscoverySkillRows(db: D1Database): Promise<DiscoverySkillRow[]> {
  const result = await db.prepare(`
    SELECT
      slug,
      name,
      description,
      content_hash AS contentHash
    FROM skills INDEXED BY skills_visibility_slug_idx
    WHERE visibility = 'public'
      AND tier != 'archived'
    ORDER BY slug ASC
  `).all<DiscoverySkillRow>();

  return result.results || [];
}

export async function resolveAgentSkillsDiscoveryIndex({
  db,
  waitUntil,
}: {
  db: D1Database | undefined;
  waitUntil?: WaitUntilFn;
}): Promise<ResolvedAgentSkillsDiscoveryIndex> {
  if (!db) {
    return {
      data: null,
      status: 503,
      cacheStatus: 'BYPASS',
      error: 'Database not available',
    };
  }

  const cached = await getCached(
    AGENT_SKILLS_DISCOVERY_INDEX_CACHE_KEY,
    async () => buildAgentSkillsDiscoveryIndex(await fetchDiscoverySkillRows(db)),
    INDEX_CACHE_TTL_SECONDS,
    { waitUntil }
  );

  return {
    data: cached.data,
    status: 200,
    cacheStatus: cached.hit ? 'HIT' : 'MISS',
  };
}

async function fetchArtifactSkill(db: D1Database, slug: string): Promise<ArtifactSkillRow | null> {
  return db.prepare(`
    SELECT
      id,
      slug,
      name,
      source_type AS sourceType,
      repo_owner AS repoOwner,
      repo_name AS repoName,
      skill_path AS skillPath,
      content_hash AS contentHash
    FROM skills INDEXED BY skills_visibility_slug_idx
    WHERE visibility = 'public'
      AND slug = ?
      AND tier != 'archived'
    LIMIT 1
  `)
    .bind(slug)
    .first<ArtifactSkillRow>();
}

async function loadArtifactContent(
  db: D1Database,
  r2: R2Bucket | undefined,
  skill: ArtifactSkillRow
): Promise<string | null> {
  if (r2) {
    try {
      const keys = skill.sourceType === 'upload'
        ? [buildUploadSkillR2Key(skill.slug, 'SKILL.md')].filter(Boolean)
        : skill.repoOwner && skill.repoName
          ? buildGithubSkillR2Keys(
              skill.repoOwner,
              skill.repoName,
              skill.skillPath,
              'SKILL.md'
            )
          : [];

      for (const key of keys) {
        const object = await r2.get(key);
        if (object) return await object.text();
      }
    } catch {
      // Fall back to the stored SKILL.md copy when R2 is temporarily unavailable.
    }
  }

  const fallback = await db.prepare(`
    SELECT readme
    FROM skills
    WHERE id = ?
      AND visibility = 'public'
    LIMIT 1
  `)
    .bind(skill.id)
    .first<{ readme: string | null }>();

  return fallback?.readme ?? null;
}

export async function computeSha256Digest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function normalizeDigest(digest: string | null): string | null {
  const normalized = String(digest ?? '').trim().toLowerCase();
  const match = normalized.match(/^sha256:([a-f0-9]{64})$/);
  return match ? `sha256:${match[1]}` : null;
}

async function resolveArtifactLookup({
  db,
  rawSlug,
  rawDigest,
}: {
  db: D1Database | undefined;
  rawSlug: string | null;
  rawDigest: string | null;
}): Promise<{
  skill: ArtifactSkillRow | null;
  digest: string | null;
  status: number;
  cacheStatus: 'BYPASS';
  error?: string;
}> {
  if (!db) {
    return {
      skill: null,
      digest: null,
      status: 503,
      cacheStatus: 'BYPASS',
      error: 'Database not available',
    };
  }

  const slug = normalizeSkillSlug(rawSlug || '');
  const digest = normalizeDigest(rawDigest);
  if (!slug || !digest) {
    return {
      skill: null,
      digest,
      status: 400,
      cacheStatus: 'BYPASS',
      error: 'Invalid skill artifact request',
    };
  }

  const skill = await fetchArtifactSkill(db, slug);
  const currentHash = normalizeSha256(skill?.contentHash ?? null);
  if (!skill || !currentHash || digest !== `sha256:${currentHash}`) {
    return {
      skill: null,
      digest,
      status: 404,
      cacheStatus: 'BYPASS',
      error: 'Skill artifact not found',
    };
  }

  return {
    skill,
    digest,
    status: 200,
    cacheStatus: 'BYPASS',
  };
}

export async function resolveAgentSkillArtifactHead({
  db,
  slug,
  digest,
}: {
  db: D1Database | undefined;
  slug: string | null;
  digest: string | null;
}): Promise<ResolvedAgentSkillArtifactHead> {
  const resolved = await resolveArtifactLookup({
    db,
    rawSlug: slug,
    rawDigest: digest,
  });

  return {
    status: resolved.status,
    cacheStatus: resolved.cacheStatus,
    ...(resolved.digest ? { digest: resolved.digest } : {}),
    ...(resolved.error ? { error: resolved.error } : {}),
  };
}

export async function resolveAgentSkillArtifact({
  db,
  r2,
  slug: rawSlug,
  digest: rawDigest,
  waitUntil,
}: {
  db: D1Database | undefined;
  r2: R2Bucket | undefined;
  slug: string | null;
  digest: string | null;
  waitUntil?: WaitUntilFn;
}): Promise<ResolvedAgentSkillArtifact> {
  const lookup = await resolveArtifactLookup({
    db,
    rawSlug,
    rawDigest,
  });
  if (!lookup.skill || !lookup.digest || !db) {
    return {
      content: null,
      status: lookup.status,
      cacheStatus: lookup.cacheStatus,
      ...(lookup.error ? { error: lookup.error } : {}),
    };
  }

  const slug = lookup.skill.slug;
  const skill = lookup.skill;
  const digest = lookup.digest;
  const currentHash = digest.slice('sha256:'.length);

  try {
    const cached = await getCachedText(
      `agent-skills:artifact:v1:${encodeURIComponent(slug)}:${currentHash}`,
      async () => {
        const content = await loadArtifactContent(db, r2, skill);
        if (content === null) {
          throw new ArtifactLoadError('Skill artifact not found', 404);
        }

        if (await computeSha256Digest(content) !== digest) {
          throw new ArtifactLoadError('Skill artifact digest mismatch', 503);
        }

        return content;
      },
      ARTIFACT_CACHE_TTL_SECONDS,
      {
        waitUntil,
      }
    );

    return {
      content: cached.data,
      status: 200,
      cacheStatus: cached.hit ? 'HIT' : 'MISS',
      digest,
    };
  } catch (error) {
    if (error instanceof ArtifactLoadError) {
      return {
        content: null,
        status: error.status,
        cacheStatus: 'BYPASS',
        error: error.message,
      };
    }
    throw error;
  }
}
