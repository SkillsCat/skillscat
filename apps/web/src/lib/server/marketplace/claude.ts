import type { D1Database } from '@cloudflare/workers-types';
import { SITE_URL } from '$lib/seo/constants';
import { buildSkillPath, parseSkillSlug } from '$lib/skill-path';
import { getCached } from '$lib/server/cache';

const CACHE_TTL_SECONDS = 600;
const MARKETPLACE_NAME = 'SkillsCat Marketplace';
const GITHUB_SHA_PATTERN = /^[0-9a-f]{40}$/i;

interface MarketplaceSkillRow {
  slug: string;
  name: string;
  description: string | null;
  repoOwner: string | null;
  repoName: string | null;
  skillPath: string | null;
  githubUrl: string | null;
  commitSha: string | null;
}

interface ClaudeMarketplaceGithubSource {
  source: 'github';
  repo: string;
  sha?: string;
}

interface ClaudeMarketplaceUrlSource {
  source: 'url';
  url: string;
  sha?: string;
}

interface ClaudeMarketplaceGitSubdirSource {
  source: 'git-subdir';
  url: string;
  path: string;
  sha?: string;
}

export type ClaudeMarketplacePluginSource =
  | ClaudeMarketplaceGithubSource
  | ClaudeMarketplaceUrlSource
  | ClaudeMarketplaceGitSubdirSource;

export interface ClaudeMarketplacePlugin {
  name: string;
  description: string;
  homepage: string;
  repository: string;
  source: ClaudeMarketplacePluginSource;
  strict: false;
  skills: string[];
}

export interface ClaudeMarketplacePayload {
  name: string;
  plugins: ClaudeMarketplacePlugin[];
}

export interface ResolvedClaudeMarketplace {
  data: ClaudeMarketplacePayload | null;
  cacheControl: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  error?: string;
  status: number;
}

function normalizeRepoUrl(url: string | null | undefined): string {
  const trimmed = String(url ?? '').trim().replace(/\/+$/, '');
  return trimmed;
}

function buildRepositoryUrl(row: MarketplaceSkillRow): string {
  const normalizedUrl = normalizeRepoUrl(row.githubUrl);
  if (normalizedUrl) {
    return normalizedUrl;
  }

  const repoOwner = String(row.repoOwner ?? '').trim();
  const repoName = String(row.repoName ?? '').trim();
  if (!repoOwner || !repoName) {
    return SITE_URL;
  }

  return `https://github.com/${repoOwner}/${repoName}`;
}

function isGitHubRepositoryUrl(url: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com';
  } catch {
    return /^https:\/\/(?:www\.)?github\.com\//i.test(url);
  }
}

function normalizeRepoSubdirPath(path: string | null | undefined): string | null {
  const normalized = String(path ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!normalized) return '';
  if (normalized.includes('\\')) return null;

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return '';
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;

  return segments.join('/');
}

function getPinnedCommitSha(commitSha: string | null | undefined): string | undefined {
  const normalized = String(commitSha ?? '').trim();
  return GITHUB_SHA_PATTERN.test(normalized) ? normalized : undefined;
}

function buildSourceBaseFields(commitSha: string | null | undefined): { sha?: string } {
  const sha = getPinnedCommitSha(commitSha);
  return sha ? { sha } : {};
}

function buildSkillDescription(row: MarketplaceSkillRow): string {
  const description = String(row.description ?? '').trim();
  if (description) {
    return description;
  }

  return `Install the ${row.name} skill from SkillsCat.`;
}

function sanitizePluginNameSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortSlugHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

export function buildClaudeMarketplacePluginName(slug: string): string {
  const parts = parseSkillSlug(slug);
  const segments = parts ? [parts.owner, ...parts.name.split('/')] : [slug];
  const readable = segments.map(sanitizePluginNameSegment).filter(Boolean).join('--') || 'skill';
  const trimmed = readable.slice(0, 72).replace(/-+$/g, '') || 'skill';
  return `skillscat-${trimmed}-${shortSlugHash(slug)}`;
}

export function buildClaudeMarketplacePluginSource(
  row: Pick<MarketplaceSkillRow, 'repoOwner' | 'repoName' | 'skillPath' | 'githubUrl' | 'commitSha'>
): ClaudeMarketplacePluginSource | null {
  const repoOwner = String(row.repoOwner ?? '').trim();
  const repoName = String(row.repoName ?? '').trim();
  if (!repoOwner || !repoName) {
    return null;
  }

  const repoPath = `${repoOwner}/${repoName}`;
  const repositoryUrl = buildRepositoryUrl({
    slug: '',
    name: '',
    description: null,
    repoOwner,
    repoName,
    skillPath: row.skillPath ?? null,
    githubUrl: row.githubUrl ?? null,
    commitSha: row.commitSha ?? null,
  });
  const skillPath = normalizeRepoSubdirPath(row.skillPath);
  if (skillPath === null) {
    return null;
  }
  const sourceBaseFields = buildSourceBaseFields(row.commitSha);

  if (skillPath) {
    return {
      source: 'git-subdir',
      url: isGitHubRepositoryUrl(repositoryUrl) ? repoPath : repositoryUrl,
      path: skillPath,
      ...sourceBaseFields,
    };
  }

  if (isGitHubRepositoryUrl(repositoryUrl)) {
    return {
      source: 'github',
      repo: repoPath,
      ...sourceBaseFields,
    };
  }

  return {
    source: 'url',
    url: repositoryUrl,
    ...sourceBaseFields,
  };
}

export function buildClaudeMarketplacePlugin(row: MarketplaceSkillRow): ClaudeMarketplacePlugin | null {
  const source = buildClaudeMarketplacePluginSource(row);
  if (!source) {
    return null;
  }

  return {
    name: buildClaudeMarketplacePluginName(row.slug),
    description: buildSkillDescription(row),
    homepage: `${SITE_URL}${buildSkillPath(row.slug)}`,
    repository: buildRepositoryUrl(row),
    source,
    strict: false,
    skills: ['./'],
  };
}

async function fetchMarketplaceSkills(db: D1Database): Promise<MarketplaceSkillRow[]> {
  // Claude marketplace entries must point at an installable git source.
  // Upload-only skills stay on SkillsCat's native install flow for now.
  const result = await db.prepare(`
    SELECT
      s.slug,
      s.name,
      s.description,
      s.repo_owner as repoOwner,
      s.repo_name as repoName,
      s.skill_path as skillPath,
      s.github_url as githubUrl,
      s.commit_sha as commitSha
    FROM skills s INDEXED BY skills_visibility_trending_desc_idx
    WHERE s.visibility = 'public'
      AND s.source_type = 'github'
      AND s.repo_owner IS NOT NULL
      AND s.repo_owner != ''
      AND s.repo_name IS NOT NULL
      AND s.repo_name != ''
    ORDER BY s.trending_score DESC, s.updated_at DESC, s.slug ASC
  `).all<MarketplaceSkillRow>();

  return result.results || [];
}

function buildMarketplacePayload(rows: MarketplaceSkillRow[]): ClaudeMarketplacePayload {
  const plugins = rows
    .map((row) => buildClaudeMarketplacePlugin(row))
    .filter((plugin): plugin is ClaudeMarketplacePlugin => Boolean(plugin));

  return {
    name: MARKETPLACE_NAME,
    plugins,
  };
}

export async function resolveClaudeMarketplace({
  db,
  waitUntil,
}: {
  db: D1Database | undefined;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<ResolvedClaudeMarketplace> {
  if (!db) {
    return {
      data: null,
      cacheControl: 'no-store',
      cacheStatus: 'BYPASS',
      error: 'Database not available',
      status: 503,
    };
  }

  const cached = await getCached(
    'claude-marketplace:v1',
    async () => buildMarketplacePayload(await fetchMarketplaceSkills(db)),
    CACHE_TTL_SECONDS,
    { waitUntil }
  );

  return {
    data: cached.data,
    cacheControl: `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=3600`,
    cacheStatus: cached.hit ? 'HIT' : 'MISS',
    status: 200,
  };
}
