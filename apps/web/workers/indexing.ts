/**
 * Indexing Worker
 *
 * 消费 indexing 队列，获取 GitHub 仓库信息并入库
 * - 检查仓库是否包含 SKILL.md
 * - 获取仓库元数据
 * - 存储到 D1 数据库
 * - 缓存 SKILL.md 及目录下所有文本文件到 R2
 * - 发送到 classification 队列
 */

import type {
  IndexingEnv,
  IndexingMessage,
  ClassificationMessage,
  GitHubRepo,
  GitHubContent,
  MessageBatch,
  ExecutionContext,
  GitHubTreeResponse,
  DirectoryFile,
  FileStructure,
} from './shared/types';
import {
  githubFetch,
  getRepoApiUrl,
  getContentsApiUrl,
  generateId,
  generateSlug,
  createLogger,
  isTextFile,
  decodeBase64ToUtf8,
  buildFileTree,
} from './shared/utils';
import { githubRequest } from '../src/lib/server/github-client/request';
import { getGitHubRequestAuthFromEnv } from '../src/lib/server/github-client/env';
import { invalidateCache } from '../src/lib/server/cache';
import { PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS } from '../src/lib/server/cache/keys';
import { markRecommendDirty } from '../src/lib/server/ranking/recommend-precompute';
import { deleteSkillArtifactsAndInvalidateCaches } from '../src/lib/server/skill/delete';
import {
  compareCanonicalSkillCandidates,
  computeBundleManifestHash,
  computeExactBundleFingerprint,
  computeSkillMdHashes,
  convertPrivateSkillToPublicGithub,
  findSkillsByExactHashGroup,
  storeSkillHashes,
  type CanonicalSkillCandidate,
} from '../src/lib/server/skill/dedup';
import { normalizeExtractedSkillTitle, stripYamlInlineComment } from '../src/lib/server/skill/title';
import { resolveSkillRelativePath } from '../src/lib/server/skill/scope';
import { buildSecurityContentFingerprint } from '../src/lib/server/security';
import {
  buildSecurityAnalysisMessage,
  markSkillSecurityDirty,
  queueSecurityAnalysis,
} from '../src/lib/server/security/state';
import {
  buildIndexNowSkillUrls,
  isIndexNowEnabled,
  loadIndexNowSkillTarget,
  scheduleIndexNowSubmission,
} from '../src/lib/server/seo/indexnow';
import {
  buildGithubSkillR2Key,
  buildGithubSkillR2Keys,
  buildGithubSkillR2Prefix,
} from '../src/lib/skill-path';
import { canonicalizeCategorySlug } from './shared/classification/categories';

const log = createLogger('Indexing');

// ============================================
// Configuration Constants
// ============================================

const MAX_FILES = 50;              // 最大文件数
const MAX_FILE_SIZE = 512 * 1024;  // 单文件最大 512KB
const MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 总大小最大 5MB
const MAX_DISCOVERED_SKILLS_PER_REPO = 100;
const INDEXING_PROCESSED_TTL_SECONDS = 30 * 24 * 60 * 60;
const INDEXING_PENDING_TTL_SECONDS = 6 * 60 * 60;

async function invalidatePublicDiscoveryCaches(reason: string): Promise<void> {
  try {
    await Promise.all(
      PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS.map((cacheKey) => invalidateCache(cacheKey))
    );
  } catch (error) {
    log.error(`Failed to invalidate public discovery caches after ${reason}`, error);
  }
}

// ============================================
// YAML Frontmatter Parsing
// ============================================

interface SkillFrontmatter {
  name?: string;
  description?: string;
  category?: string;           // Single category slug
  categories?: string;         // Comma-separated category slugs
  keywords?: string;           // Alias for tags
  metadata?: {
    tags?: string; // comma-separated string
    category?: string;         // Also check nested
    categories?: string;
  };
}

interface ParsedSkillMd {
  frontmatter: SkillFrontmatter | null;
  body: string;
}

interface ResolvedSkillMetadata {
  name: string;
  description: string | null;
}

interface IndexingBatchContext {
  repoInfoByRepo: Map<string, Promise<GitHubRepo | null>>;
  latestCommitByRepoRef: Map<string, Promise<{ sha: string; branch: string } | null>>;
  repositoryTreeByRepoRef: Map<string, Promise<GitHubTreeResponse>>;
  skillCommitDatesByPath: Map<string, Promise<{ lastCommitAt: number | null; firstCommitAt: number | null }>>;
}

function createIndexingBatchContext(): IndexingBatchContext {
  return {
    repoInfoByRepo: new Map(),
    latestCommitByRepoRef: new Map(),
    repositoryTreeByRepoRef: new Map(),
    skillCommitDatesByPath: new Map(),
  };
}

function getRepoCacheKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function getRepoRefCacheKey(owner: string, repo: string, ref: string): string {
  return `${getRepoCacheKey(owner, repo)}#${ref.toLowerCase()}`;
}

function getSkillCommitDatesCacheKey(owner: string, repo: string, skillMdPath: string): string {
  return `${getRepoCacheKey(owner, repo)}:${skillMdPath.toLowerCase()}`;
}

function getOrCreateBatchPromise<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  loader: () => Promise<T>
): Promise<T> {
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const pending = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

function getLineIndent(line: string): number {
  return line.match(/^(\s*)/)?.[1].length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractYamlFieldFromLines(
  lines: string[],
  key: string,
  startIndex: number,
  endIndex: number,
  minIndent: number,
  maxIndent: number | null
): string | null {
  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(key)}:\\s*(.*)$`);

  for (let i = startIndex; i < endIndex; i++) {
    const match = lines[i].match(keyPattern);
    if (!match) continue;

    const indent = match[1].length;
    if (indent < minIndent) continue;
    if (maxIndent !== null && indent > maxIndent) continue;

    const inlineValue = match[2].trim();
    if (inlineValue.length > 0) {
      return inlineValue;
    }

    const values: string[] = [];
    for (let j = i + 1; j < endIndex; j++) {
      const nextLine = lines[j];
      if (nextLine.trim() === '') continue;

      const nextIndent = getLineIndent(nextLine);
      if (nextIndent <= indent) break;

      const trimmed = nextLine.trim();
      const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
      values.push((listMatch ? listMatch[1] : trimmed).trim());
    }

    return values.length > 0 ? values.join(',') : null;
  }

  return null;
}

function extractYamlRootField(yamlContent: string, key: string): string | null {
  const lines = yamlContent.split('\n');
  return extractYamlFieldFromLines(lines, key, 0, lines.length, 0, 0);
}

function extractYamlNestedField(yamlContent: string, parentKey: string, key: string): string | null {
  const lines = yamlContent.split('\n');
  const parentPattern = new RegExp(`^(\\s*)${escapeRegExp(parentKey)}:\\s*(.*)$`);

  for (let i = 0; i < lines.length; i++) {
    const parentMatch = lines[i].match(parentPattern);
    if (!parentMatch) continue;

    const parentIndent = parentMatch[1].length;
    let endIndex = lines.length;

    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (getLineIndent(lines[j]) <= parentIndent) {
        endIndex = j;
        break;
      }
    }

    const value = extractYamlFieldFromLines(
      lines,
      key,
      i + 1,
      endIndex,
      parentIndent + 1,
      null
    );
    if (value) return value;
  }

  return null;
}

function trimWrappingPairs(value: string): string {
  let output = value.trim();
  let changed = true;

  while (changed && output.length > 1) {
    changed = false;

    if (
      (output.startsWith('"') && output.endsWith('"'))
      || (output.startsWith("'") && output.endsWith("'"))
      || (output.startsWith('`') && output.endsWith('`'))
    ) {
      output = output.slice(1, -1).trim();
      changed = true;
      continue;
    }

    const first = output[0];
    const last = output[output.length - 1];
    if (
      (first === '[' && last === ']')
      || (first === '(' && last === ')')
      || (first === '{' && last === '}')
    ) {
      output = output.slice(1, -1).trim();
      changed = true;
    }
  }

  return output;
}

function normalizeTag(rawTag: string): string {
  let tag = trimWrappingPairs(rawTag);
  if (!tag) return '';

  // Support YAML list style tokens that leak into inline parsing (e.g. "- persona")
  tag = tag.replace(/^[-*]\s+/, '');
  tag = tag
    .replace(/^[\[\(\{]+/, '')
    .replace(/[\]\)\}]+$/, '')
    .replace(/^['"`]+/, '')
    .replace(/['"`]+$/, '');
  tag = trimWrappingPairs(tag);

  tag = tag
    .replace(/^[,;:]+/, '')
    .replace(/[,;:]+$/, '')
    .trim();

  return tag ? tag.toLowerCase() : '';
}

function normalizeTags(tagsString: string): string[] {
  const tags = trimWrappingPairs(tagsString.replace(/\r\n/g, '\n').trim())
    .split(/[,\n;，]/)
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);

  return [...new Set(tags)];
}

/**
 * Parse YAML multi-line block scalar (| or >) and format for display
 * Joins all lines with spaces and removes extra whitespace
 */
function parseYamlBlockScalar(yamlContent: string, key: string): string | null {
  // Match the key followed by | or > (with optional modifiers like |-, >+, etc.)
  const blockMatch = yamlContent.match(new RegExp(`^${key}:\\s*([|>][-+]?)\\s*$`, 'm'));
  if (!blockMatch) return null;

  const keyLineIndex = yamlContent.indexOf(blockMatch[0]);
  const afterKey = yamlContent.slice(keyLineIndex + blockMatch[0].length);

  // Find all indented lines that follow
  const lines = afterKey.split('\n');
  const contentLines: string[] = [];
  let baseIndent: number | null = null;

  for (const line of lines) {
    // Empty lines are preserved in block scalars
    if (line.trim() === '') {
      if (baseIndent !== null) {
        contentLines.push('');
      }
      continue;
    }

    // Check indentation
    const indent = line.match(/^(\s*)/)?.[1].length || 0;

    // First non-empty line sets the base indentation
    if (baseIndent === null) {
      if (indent === 0) break; // No indentation means end of block
      baseIndent = indent;
      contentLines.push(line.slice(baseIndent));
      continue;
    }

    // If line has less indentation than base, block ends
    if (indent < baseIndent) break;

    // Add line with base indentation removed
    contentLines.push(line.slice(baseIndent));
  }

  if (contentLines.length === 0) return null;

  // Handle different block scalar types
  // For display purposes, always join lines with spaces and clean up
  return contentLines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse YAML frontmatter from SKILL.md content
 * Supports format:
 * ---
 * name: skill-name
 * description: Skill description
 * category: git
 * categories: git, automation
 * keywords: tag1, tag2
 * metadata:
 *   tags: tag1, tag2, tag3
 *   category: git
 *   categories: git, automation
 * ---
 */
export function parseSkillFrontmatter(content: string): ParsedSkillMd {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];
  const frontmatter: SkillFrontmatter = {};

  // Parse name
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  if (nameMatch) frontmatter.name = stripYamlInlineComment(nameMatch[1]);

  // Parse description (supports multi-line block scalars)
  const blockDesc = parseYamlBlockScalar(yamlContent, 'description');
  if (blockDesc) {
    frontmatter.description = blockDesc;
  } else {
    const descMatch = yamlContent.match(/^description:\s*(.+)$/m);
    if (descMatch) frontmatter.description = descMatch[1].trim();
  }

  // Parse category (single, root level)
  const categoryValue = extractYamlRootField(yamlContent, 'category');
  if (categoryValue) frontmatter.category = stripYamlInlineComment(categoryValue.trim());

  // Parse categories (multiple, root level)
  const categoriesValue = extractYamlRootField(yamlContent, 'categories');
  if (categoriesValue) frontmatter.categories = stripYamlInlineComment(categoriesValue.trim());

  // Parse keywords (alias for tags, root level; supports inline and list formats)
  const keywordsValue = extractYamlRootField(yamlContent, 'keywords');
  if (keywordsValue) frontmatter.keywords = keywordsValue.trim();

  // Parse tags (prefer metadata.tags, fallback to root tags)
  const metadataTags = extractYamlNestedField(yamlContent, 'metadata', 'tags');
  const rootTags = extractYamlRootField(yamlContent, 'tags');
  const tagsValue = metadataTags || rootTags;
  if (tagsValue) {
    frontmatter.metadata = frontmatter.metadata || {};
    frontmatter.metadata.tags = tagsValue.trim();
  }

  // Parse metadata.category (nested)
  const metadataCategoryValue = extractYamlNestedField(yamlContent, 'metadata', 'category');
  if (metadataCategoryValue && !frontmatter.category) {
    frontmatter.metadata = frontmatter.metadata || {};
    frontmatter.metadata.category = stripYamlInlineComment(metadataCategoryValue.trim());
  }

  // Parse metadata.categories (nested)
  const metadataCategoriesValue = extractYamlNestedField(yamlContent, 'metadata', 'categories');
  if (metadataCategoriesValue && !frontmatter.categories) {
    frontmatter.metadata = frontmatter.metadata || {};
    frontmatter.metadata.categories = stripYamlInlineComment(metadataCategoriesValue.trim());
  }

  return { frontmatter, body };
}

export function resolveSkillMetadata(
  repo: Pick<GitHubRepo, 'name' | 'description'>,
  parsedSkillMd: ParsedSkillMd
): ResolvedSkillMetadata {
  let name = parsedSkillMd.frontmatter?.name
    ? normalizeExtractedSkillTitle(parsedSkillMd.frontmatter.name)
    : repo.name;
  let description = parsedSkillMd.frontmatter?.description || repo.description || null;

  if (!parsedSkillMd.frontmatter?.name) {
    const titleMatch = parsedSkillMd.body.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      name = normalizeExtractedSkillTitle(titleMatch[1]);
    }
  }

  if (!parsedSkillMd.frontmatter?.description) {
    const descMatch = parsedSkillMd.body.match(/^#.+\n+(.+?)(?:\n\n|\n#|$)/s);
    if (descMatch) {
      description = descMatch[1].trim().slice(0, 500);
    }
  }

  return { name, description };
}

/**
 * Curation Conversion: Check if there's a private skill with an identical bundle
 * If found, convert it to public and return the existing skill ID
 * This prevents duplicate skills when curating content that users have already published privately
 */
async function checkAndConvertPrivateSkill(
  fullHash: string,
  exactBundleFingerprint: string,
  repo: GitHubRepo,
  skillMetadata: ResolvedSkillMetadata,
  persistenceMetadata: SkillPersistenceMetadata,
  commitSha: string,
  fileStructure: FileStructure,
  skillPath: string | null,
  env: IndexingEnv
): Promise<{ converted: boolean; skillId?: string; slug?: string }> {
  const [existingPrivate] = await findSkillsByExactHashGroup(env.DB, fullHash, exactBundleFingerprint, {
    visibility: 'private',
    limit: 1,
  });

  if (!existingPrivate) {
    return { converted: false };
  }

  const now = Date.now();

  await convertPrivateSkillToPublicGithub(env.DB, {
    skillId: existingPrivate.id,
    name: skillMetadata.name,
    description: skillMetadata.description,
    repoOwner: repo.owner.login,
    repoName: repo.name,
    skillPath,
    githubUrl: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    contentHash: persistenceMetadata.contentHash,
    commitSha,
    fileStructure: JSON.stringify(fileStructure),
    lastCommitAt: persistenceMetadata.lastCommitAt,
    skillMdFirstCommitAt: persistenceMetadata.skillMdFirstCommitAt,
    repoCreatedAt: persistenceMetadata.repoCreatedAt,
    indexedAt: now,
    updatedAt: persistenceMetadata.lastCommitAt ?? now,
  });

  log.log(`Converted private skill to public: ${existingPrivate.slug} (${existingPrivate.id})`);

  // Send notification to the owner if there is one
  if (existingPrivate.ownerId) {
    const notificationId = generateId();
    await env.DB.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        notificationId,
        existingPrivate.ownerId,
        'skill_curated',
        'Your skill has been curated!',
        `Your skill "${existingPrivate.slug}" has been converted to public as part of the SkillsCat curation process. Your skill is now discoverable by everyone in the registry.`,
        JSON.stringify({ skillId: existingPrivate.id, skillSlug: existingPrivate.slug }),
        now
      )
      .run();

    log.log(`Sent curation notification to user ${existingPrivate.ownerId} for skill ${existingPrivate.slug}`);
  }

  return {
    converted: true,
    skillId: existingPrivate.id,
    slug: existingPrivate.slug
  };
}

// ============================================
// Commit SHA & Directory Indexing Functions
// ============================================

/**
 * Get the latest commit SHA from GitHub repository
 */
async function getLatestCommitSha(
  owner: string,
  name: string,
  env: IndexingEnv,
  defaultBranch?: string
): Promise<{ sha: string; branch: string } | null> {
  const branch = defaultBranch || 'main';

  // Get latest commit
  const commitUrl = `https://api.github.com/repos/${owner}/${name}/commits/${branch}`;
  const commitInfo = await githubFetch<{ sha: string }>(commitUrl, {
    ...getGitHubRequestAuthFromEnv(env),
    apiVersion: env.GITHUB_API_VERSION,
    userAgent: 'SkillsCat-Indexing-Worker/1.0',
  });

  if (!commitInfo) return null;

  return { sha: commitInfo.sha, branch };
}

/**
 * Extract the "last" pagination URL from a GitHub Link header.
 */
function extractLastLinkUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="last"/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * GitHub's commit payload exposes both authored time and committed time.
 * For canonical/original skill comparison we care about when the SKILL.md
 * content first came into existence, so we prefer author.date there.
 * For activity freshness we keep using committer.date.
 */
interface GitHubPathCommit {
  sha?: string;
  commit?: {
    author?: {
      date?: string | null;
    } | null;
    committer?: {
      date?: string | null;
    } | null;
  } | null;
}

function parseGitHubCommitDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getGitHubPathCommitCreatedAt(commit: GitHubPathCommit | null | undefined): number | null {
  return parseGitHubCommitDate(commit?.commit?.author?.date)
    ?? parseGitHubCommitDate(commit?.commit?.committer?.date);
}

function getGitHubPathCommitUpdatedAt(commit: GitHubPathCommit | null | undefined): number | null {
  return parseGitHubCommitDate(commit?.commit?.committer?.date)
    ?? parseGitHubCommitDate(commit?.commit?.author?.date);
}

/**
 * Get the newest activity time and the earliest authored time for SKILL.md.
 */
async function getSkillCommitDates(
  owner: string,
  name: string,
  skillMdPath: string,
  env: IndexingEnv
): Promise<{ lastCommitAt: number | null; firstCommitAt: number | null }> {
  const commitsUrl = `https://api.github.com/repos/${owner}/${name}/commits?per_page=1&path=${encodeURIComponent(skillMdPath)}`;
  const newestResponse = await githubRequest(commitsUrl, {
    ...getGitHubRequestAuthFromEnv(env),
    apiVersion: env.GITHUB_API_VERSION,
    userAgent: 'SkillsCat-Indexing-Worker/1.0',
  });

  if (newestResponse.status === 404) {
    log.log(`No commits found for path: ${skillMdPath}`);
    return { lastCommitAt: null, firstCommitAt: null };
  }

  if (!newestResponse.ok) {
    throw new Error(`Failed to fetch commit history for ${owner}/${name}/${skillMdPath}: ${newestResponse.status}`);
  }

  const newestCommits = await newestResponse.json() as GitHubPathCommit[];

  if (!newestCommits || newestCommits.length === 0) {
    log.log(`No commits found for path: ${skillMdPath}`);
    return { lastCommitAt: null, firstCommitAt: null };
  }

  const lastCommitAt = getGitHubPathCommitUpdatedAt(newestCommits[0]);
  let firstCommitAt = getGitHubPathCommitCreatedAt(newestCommits[0]) ?? lastCommitAt;

  const lastPageUrl = extractLastLinkUrl(newestResponse.headers.get('link'));
  if (lastPageUrl) {
    const oldestResponse = await githubRequest(lastPageUrl, {
      ...getGitHubRequestAuthFromEnv(env),
      apiVersion: env.GITHUB_API_VERSION,
      userAgent: 'SkillsCat-Indexing-Worker/1.0',
    });

    if (oldestResponse.ok) {
      const oldestCommits = await oldestResponse.json() as GitHubPathCommit[];

      if (oldestCommits.length > 0) {
        firstCommitAt = getGitHubPathCommitCreatedAt(oldestCommits[oldestCommits.length - 1]) ?? firstCommitAt;
      }
    }
  }

  log.log(`Commit dates for ${skillMdPath}: first=${firstCommitAt}, last=${lastCommitAt}`);

  return { lastCommitAt, firstCommitAt };
}

function getSkillPathFromSkillMdPath(path: string): string | null {
  const normalizedPath = path.replace(/^\/+/, '');
  const parts = normalizedPath.split('/');
  parts.pop();
  const skillPath = parts.join('/');
  return skillPath || null;
}

async function getRepositoryTree(
  owner: string,
  name: string,
  branch: string,
  env: IndexingEnv
): Promise<GitHubTreeResponse> {
  const treeUrl = `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`;
  const treeData = await githubFetch<GitHubTreeResponse>(treeUrl, {
    ...getGitHubRequestAuthFromEnv(env),
    apiVersion: env.GITHUB_API_VERSION,
    userAgent: 'SkillsCat-Indexing-Worker/1.0',
  });

  if (!treeData) {
    throw new Error('Failed to fetch repository tree for skill path scan');
  }

  return treeData;
}

async function getRepositoryTreeCached(
  owner: string,
  name: string,
  branch: string,
  env: IndexingEnv,
  batchContext: IndexingBatchContext
): Promise<GitHubTreeResponse> {
  return getOrCreateBatchPromise(
    batchContext.repositoryTreeByRepoRef,
    getRepoRefCacheKey(owner, name, branch),
    () => getRepositoryTree(owner, name, branch, env)
  );
}

function scanRepositorySkillPathsFromTree(treeData: GitHubTreeResponse): string[] {
  const discoveredPaths = new Set<string>();
  for (const item of treeData.tree) {
    if (item.type !== 'blob') continue;
    const fileName = item.path.split('/').pop()?.toLowerCase();
    if (fileName !== 'skill.md') continue;

    discoveredPaths.add(getSkillPathFromSkillMdPath(item.path) || '');
    if (discoveredPaths.size >= MAX_DISCOVERED_SKILLS_PER_REPO) {
      break;
    }
  }

  return [...discoveredPaths].sort((left, right) => {
    const leftDepth = left ? left.split('/').length : 0;
    const rightDepth = right ? right.split('/').length : 0;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
    return left.localeCompare(right);
  });
}

async function scanRepositorySkillPaths(
  owner: string,
  name: string,
  branch: string,
  env: IndexingEnv,
  batchContext: IndexingBatchContext
): Promise<string[]> {
  const treeData = await getRepositoryTreeCached(owner, name, branch, env, batchContext);
  return scanRepositorySkillPathsFromTree(treeData);
}

/**
 * Get stored commit SHA from database
 */
export interface ExistingSkillSnapshot {
  id: string;
  slug: string;
  sourceType: string;
  visibility: string;
  repoOwner: string | null;
  repoName: string | null;
  skillPath: string | null;
  stars: number;
  commitSha: string | null;
  fileStructure: string | null;
  lastCommitAt: number | null;
  skillMdFirstCommitAt: number | null;
  repoCreatedAt: number | null;
  createdAt: number;
  indexedAt: number | null;
}

interface ExistingSourceState {
  id: string;
  visibleSkillId: string | null;
  currentSnapshotId: string | null;
  currentCommitSha: string | null;
  latestVersionId: string | null;
  latestVersionCommitSha: string | null;
  lineageRootSnapshotId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface SkillSourceRecord {
  id: string;
  visibleSkillId: string | null;
  currentSnapshotId: string | null;
  currentCommitSha: string | null;
  latestVersionId: string | null;
  lineageRootSnapshotId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface SnapshotCanonicalState {
  id: string;
  bundleExactFingerprint: string;
  bundleSemanticFingerprint: string | null;
  skillMdBlobSha: string | null;
  skillMdNormalizedSha256: string | null;
  canonicalSourceId: string | null;
  canonicalSkillId: string | null;
  canonicalSlug: string | null;
  canonicalRepoOwner: string | null;
  canonicalRepoName: string | null;
  canonicalSkillPath: string | null;
  canonicalVersionId: string | null;
  canonicalCommitSha: string | null;
  canonicalCommitAt: number | null;
  canonicalSourceLineageRootSnapshotId: string | null;
  canonicalSourceCurrentSnapshotId: string | null;
  canonicalSourceVisibleSkillId: string | null;
  candidateSkillId: string | null;
  candidateSlug: string | null;
  candidateRepoOwner: string | null;
  candidateRepoName: string | null;
  candidateSkillPath: string | null;
  candidateSourceType: string | null;
  candidateVisibility: string | null;
  candidateStars: number | null;
  candidateLastCommitAt: number | null;
  candidateSkillMdFirstCommitAt: number | null;
  candidateRepoCreatedAt: number | null;
  candidateCreatedAt: number | null;
  candidateIndexedAt: number | null;
}

interface SkillSnapshotRecord {
  id: string;
  bundleExactFingerprint: string;
  bundleSemanticFingerprint: string | null;
  skillMdBlobSha: string | null;
  skillMdNormalizedSha256: string | null;
  canonicalSourceId: string | null;
  canonicalSkillId: string | null;
  canonicalSlug: string | null;
  canonicalRepoOwner: string | null;
  canonicalRepoName: string | null;
  canonicalSkillPath: string | null;
  canonicalVersionId: string | null;
  canonicalCommitSha: string | null;
  canonicalCommitAt: number | null;
}

interface SkillVersionRecord {
  id: string;
  sourceId: string;
  snapshotId: string;
  previousVersionId: string | null;
  commitSha: string;
  relationType: string;
}

interface SkillOriginMetadata {
  originSkillId: string | null;
  originSlug: string | null;
  originRepoOwner: string | null;
  originRepoName: string | null;
  originSkillPath: string | null;
  originCommitSha: string | null;
  originRelationType: 'modified_from' | 'historical_copy_of' | 'canonical' | null;
}

interface SnapshotFingerprintInput {
  bundleExactFingerprint: string;
  bundleSemanticFingerprint: string;
  skillMdBlobSha: string | null;
  skillMdNormalizedSha256: string;
}

export async function getExistingSkillSnapshot(
  owner: string,
  name: string,
  skillPath: string | null,
  env: IndexingEnv
): Promise<ExistingSkillSnapshot | null> {
  const normalizedPath = skillPath || '';

  const result = await env.DB.prepare(`
    SELECT
      id,
      slug,
      source_type AS sourceType,
      visibility,
      repo_owner AS repoOwner,
      repo_name AS repoName,
      skill_path AS skillPath,
      stars,
      commit_sha AS commitSha,
      file_structure AS fileStructure,
      last_commit_at AS lastCommitAt,
      skill_md_first_commit_at AS skillMdFirstCommitAt,
      repo_created_at AS repoCreatedAt,
      created_at AS createdAt,
      indexed_at AS indexedAt
    FROM skills
    WHERE repo_owner = ? AND repo_name = ? AND COALESCE(skill_path, '') = ?
    LIMIT 1
  `)
    .bind(owner, name, normalizedPath)
    .first<ExistingSkillSnapshot>();

  return result || null;
}

async function getExistingSourceState(
  owner: string,
  name: string,
  skillPath: string | null,
  env: IndexingEnv
): Promise<ExistingSourceState | null> {
  const normalizedPath = skillPath || '';

  return (await env.DB.prepare(`
    SELECT
      ss.id,
      ss.visible_skill_id AS visibleSkillId,
      ss.current_snapshot_id AS currentSnapshotId,
      ss.current_commit_sha AS currentCommitSha,
      ss.latest_version_id AS latestVersionId,
      lv.commit_sha AS latestVersionCommitSha,
      ss.lineage_root_snapshot_id AS lineageRootSnapshotId,
      ss.created_at AS createdAt,
      ss.updated_at AS updatedAt
    FROM skill_sources ss
    LEFT JOIN skill_versions lv ON lv.id = ss.latest_version_id
    WHERE ss.repo_owner = ?
      AND ss.repo_name = ?
      AND ss.skill_path = ?
    LIMIT 1
  `)
    .bind(owner, name, normalizedPath)
    .first<ExistingSourceState>()) || null;
}

export function getStoredSourceCommitSha(source: {
  currentCommitSha: string | null;
  latestVersionCommitSha?: string | null;
} | null): string | null {
  if (!source) return null;
  return source.currentCommitSha
    ?? ('latestVersionCommitSha' in source ? source.latestVersionCommitSha : null)
    ?? null;
}

async function loadSnapshotCanonicalState(
  db: D1Database,
  field: 'id' | 'bundle_exact_fingerprint',
  value: string
): Promise<SnapshotCanonicalState | null> {
  const fieldSql = field === 'id' ? 'ss.id' : 'ss.bundle_exact_fingerprint';

  return (await db.prepare(`
    SELECT
      ss.id,
      ss.bundle_exact_fingerprint AS bundleExactFingerprint,
      ss.bundle_semantic_fingerprint AS bundleSemanticFingerprint,
      ss.skill_md_blob_sha AS skillMdBlobSha,
      ss.skill_md_normalized_sha256 AS skillMdNormalizedSha256,
      ss.canonical_source_id AS canonicalSourceId,
      ss.canonical_skill_id AS canonicalSkillId,
      ss.canonical_slug AS canonicalSlug,
      ss.canonical_repo_owner AS canonicalRepoOwner,
      ss.canonical_repo_name AS canonicalRepoName,
      ss.canonical_skill_path AS canonicalSkillPath,
      ss.canonical_version_id AS canonicalVersionId,
      ss.canonical_commit_sha AS canonicalCommitSha,
      ss.canonical_commit_at AS canonicalCommitAt,
      cs.lineage_root_snapshot_id AS canonicalSourceLineageRootSnapshotId,
      cs.current_snapshot_id AS canonicalSourceCurrentSnapshotId,
      cs.visible_skill_id AS canonicalSourceVisibleSkillId,
      s.id AS candidateSkillId,
      s.slug AS candidateSlug,
      s.repo_owner AS candidateRepoOwner,
      s.repo_name AS candidateRepoName,
      s.skill_path AS candidateSkillPath,
      s.source_type AS candidateSourceType,
      s.visibility AS candidateVisibility,
      s.stars AS candidateStars,
      s.last_commit_at AS candidateLastCommitAt,
      s.skill_md_first_commit_at AS candidateSkillMdFirstCommitAt,
      s.repo_created_at AS candidateRepoCreatedAt,
      s.created_at AS candidateCreatedAt,
      s.indexed_at AS candidateIndexedAt
    FROM skill_snapshots ss
    LEFT JOIN skill_sources cs ON cs.id = ss.canonical_source_id
    LEFT JOIN skills s ON s.id = ss.canonical_skill_id
    WHERE ${fieldSql} = ?
    LIMIT 1
  `)
    .bind(value)
    .first<SnapshotCanonicalState>()) || null;
}

async function getSnapshotCanonicalStateByExactFingerprint(
  exactFingerprint: string,
  db: D1Database
): Promise<SnapshotCanonicalState | null> {
  return loadSnapshotCanonicalState(db, 'bundle_exact_fingerprint', exactFingerprint);
}

async function getSnapshotCanonicalStateById(
  snapshotId: string,
  db: D1Database
): Promise<SnapshotCanonicalState | null> {
  return loadSnapshotCanonicalState(db, 'id', snapshotId);
}

function buildSourceCandidateSlug(
  owner: string,
  repo: string,
  skillPath: string | null,
  existingSlug?: string | null
): string {
  if (existingSlug) return existingSlug;
  return generateSlug(owner, repo, skillPath || undefined);
}

function buildCanonicalCandidateForSource(params: {
  sourceId: string;
  slug: string;
  repo: GitHubRepo;
  skillPath: string | null;
  persistenceMetadata: SkillPersistenceMetadata;
  sourceCreatedAt: number;
  sourceIndexedAt: number;
}): CanonicalSkillCandidate {
  return {
    id: params.sourceId,
    slug: params.slug,
    repoOwner: params.repo.owner.login,
    repoName: params.repo.name,
    skillPath: params.skillPath,
    sourceType: 'github',
    visibility: 'public',
    stars: params.repo.stargazers_count,
    lastCommitAt: params.persistenceMetadata.lastCommitAt,
    skillMdFirstCommitAt: params.persistenceMetadata.skillMdFirstCommitAt,
    repoCreatedAt: params.persistenceMetadata.repoCreatedAt,
    createdAt: params.sourceCreatedAt,
    indexedAt: params.sourceIndexedAt,
  };
}

function buildCanonicalCandidateFromSnapshotState(
  snapshot: SnapshotCanonicalState | null
): CanonicalSkillCandidate | null {
  if (!snapshot?.canonicalSourceId) {
    return null;
  }

  return {
    id: snapshot.canonicalSourceId,
    slug: snapshot.candidateSlug
      || snapshot.canonicalSlug
      || buildSourceCandidateSlug(
        snapshot.canonicalRepoOwner || '',
        snapshot.canonicalRepoName || '',
        snapshot.canonicalSkillPath
      ),
    repoOwner: snapshot.candidateRepoOwner || snapshot.canonicalRepoOwner,
    repoName: snapshot.candidateRepoName || snapshot.canonicalRepoName,
    skillPath: snapshot.candidateSkillPath ?? snapshot.canonicalSkillPath,
    sourceType: snapshot.candidateSourceType || 'github',
    visibility: snapshot.candidateVisibility || 'public',
    stars: snapshot.candidateStars || 0,
    lastCommitAt: snapshot.candidateLastCommitAt,
    skillMdFirstCommitAt: snapshot.candidateSkillMdFirstCommitAt ?? snapshot.canonicalCommitAt,
    repoCreatedAt: snapshot.candidateRepoCreatedAt,
    createdAt: snapshot.candidateCreatedAt ?? Date.now(),
    indexedAt: snapshot.candidateIndexedAt,
  };
}

export function determineSkillVersionRelationType(params: {
  sourceId: string;
  currentSnapshotId: string;
  lineageRootSnapshotId: string | null;
  canonicalSourceId: string | null;
}): 'canonical' | 'modified_from' | 'historical_copy_of' {
  if (params.lineageRootSnapshotId && params.lineageRootSnapshotId !== params.currentSnapshotId) {
    return 'modified_from';
  }

  if (params.canonicalSourceId && params.canonicalSourceId !== params.sourceId) {
    return 'historical_copy_of';
  }

  return 'canonical';
}

export function resolveVisibleSkillOriginMetadata(params: {
  sourceId: string;
  currentSnapshotId: string;
  lineageRootSnapshotId: string | null;
  lineageRootSnapshot: Pick<
    SnapshotCanonicalState,
    | 'canonicalSourceId'
    | 'canonicalSkillId'
    | 'canonicalSlug'
    | 'canonicalRepoOwner'
    | 'canonicalRepoName'
    | 'canonicalSkillPath'
    | 'canonicalCommitSha'
  > | null;
}): SkillOriginMetadata {
  const rootSnapshot = params.lineageRootSnapshot;
  if (!params.lineageRootSnapshotId || !rootSnapshot?.canonicalSourceId) {
    return {
      originSkillId: null,
      originSlug: null,
      originRepoOwner: null,
      originRepoName: null,
      originSkillPath: null,
      originCommitSha: null,
      originRelationType: null,
    };
  }

  if (rootSnapshot.canonicalSourceId === params.sourceId) {
    return {
      originSkillId: null,
      originSlug: null,
      originRepoOwner: null,
      originRepoName: null,
      originSkillPath: null,
      originCommitSha: null,
      originRelationType: null,
    };
  }

  return {
    originSkillId: rootSnapshot.canonicalSkillId,
    originSlug: rootSnapshot.canonicalSlug,
    originRepoOwner: rootSnapshot.canonicalRepoOwner,
    originRepoName: rootSnapshot.canonicalRepoName,
    originSkillPath: rootSnapshot.canonicalSkillPath,
    originCommitSha: rootSnapshot.canonicalCommitSha,
    originRelationType: params.lineageRootSnapshotId === params.currentSnapshotId
      ? 'historical_copy_of'
      : 'modified_from',
  };
}

async function getOrCreateSkillSource(
  owner: string,
  repo: string,
  skillPath: string | null,
  env: IndexingEnv,
  seed?: {
    visibleSkillId?: string | null;
    currentCommitSha?: string | null;
  }
): Promise<SkillSourceRecord> {
  const normalizedPath = skillPath || '';
  const existing = await getExistingSourceState(owner, repo, skillPath, env);
  if (existing) {
    return {
      id: existing.id,
      visibleSkillId: existing.visibleSkillId,
      currentSnapshotId: existing.currentSnapshotId,
      currentCommitSha: existing.currentCommitSha,
      latestVersionId: existing.latestVersionId,
      lineageRootSnapshotId: existing.lineageRootSnapshotId,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  const sourceId = generateId();
  const now = Date.now();

  try {
    await env.DB.prepare(`
      INSERT INTO skill_sources (
        id,
        repo_owner,
        repo_name,
        skill_path,
        visible_skill_id,
        current_commit_sha,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        sourceId,
        owner,
        repo,
        normalizedPath,
        seed?.visibleSkillId ?? null,
        seed?.currentCommitSha ?? null,
        now,
        now
      )
      .run();
  } catch (error) {
    const message = String(error);
    if (!message.includes('skill_sources_repo_path_unique')) {
      throw error;
    }
  }

  const created = await getExistingSourceState(owner, repo, skillPath, env);
  if (!created) {
    throw new Error(`Failed to create skill source for ${owner}/${repo}${normalizedPath ? `/${normalizedPath}` : ''}`);
  }

  return {
    id: created.id,
    visibleSkillId: created.visibleSkillId,
    currentSnapshotId: created.currentSnapshotId,
    currentCommitSha: created.currentCommitSha,
    latestVersionId: created.latestVersionId,
    lineageRootSnapshotId: created.lineageRootSnapshotId,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

async function getOrCreateSkillSnapshot(
  fingerprint: SnapshotFingerprintInput,
  db: D1Database
): Promise<SkillSnapshotRecord> {
  const existing = await getSnapshotCanonicalStateByExactFingerprint(
    fingerprint.bundleExactFingerprint,
    db
  );

  if (existing) {
    await db.prepare(`
      UPDATE skill_snapshots
      SET
        bundle_semantic_fingerprint = COALESCE(bundle_semantic_fingerprint, ?),
        skill_md_blob_sha = COALESCE(skill_md_blob_sha, ?),
        skill_md_normalized_sha256 = COALESCE(skill_md_normalized_sha256, ?),
        updated_at = ?
      WHERE id = ?
    `)
      .bind(
        fingerprint.bundleSemanticFingerprint,
        fingerprint.skillMdBlobSha,
        fingerprint.skillMdNormalizedSha256,
        Date.now(),
        existing.id
      )
      .run();

    return {
      id: existing.id,
      bundleExactFingerprint: existing.bundleExactFingerprint,
      bundleSemanticFingerprint: existing.bundleSemanticFingerprint,
      skillMdBlobSha: existing.skillMdBlobSha,
      skillMdNormalizedSha256: existing.skillMdNormalizedSha256,
      canonicalSourceId: existing.canonicalSourceId,
      canonicalSkillId: existing.canonicalSkillId,
      canonicalSlug: existing.canonicalSlug,
      canonicalRepoOwner: existing.canonicalRepoOwner,
      canonicalRepoName: existing.canonicalRepoName,
      canonicalSkillPath: existing.canonicalSkillPath,
      canonicalVersionId: existing.canonicalVersionId,
      canonicalCommitSha: existing.canonicalCommitSha,
      canonicalCommitAt: existing.canonicalCommitAt,
    };
  }

  const snapshotId = generateId();
  const now = Date.now();
  await db.prepare(`
    INSERT INTO skill_snapshots (
      id,
      bundle_exact_fingerprint,
      bundle_semantic_fingerprint,
      skill_md_blob_sha,
      skill_md_normalized_sha256,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      snapshotId,
      fingerprint.bundleExactFingerprint,
      fingerprint.bundleSemanticFingerprint,
      fingerprint.skillMdBlobSha,
      fingerprint.skillMdNormalizedSha256,
      now,
      now
    )
    .run();

  return {
    id: snapshotId,
    bundleExactFingerprint: fingerprint.bundleExactFingerprint,
    bundleSemanticFingerprint: fingerprint.bundleSemanticFingerprint,
    skillMdBlobSha: fingerprint.skillMdBlobSha,
    skillMdNormalizedSha256: fingerprint.skillMdNormalizedSha256,
    canonicalSourceId: null,
    canonicalSkillId: null,
    canonicalSlug: null,
    canonicalRepoOwner: null,
    canonicalRepoName: null,
    canonicalSkillPath: null,
    canonicalVersionId: null,
    canonicalCommitSha: null,
    canonicalCommitAt: null,
  };
}

async function getSourceLineageRootSnapshotId(
  sourceId: string,
  db: D1Database
): Promise<string | null> {
  const result = await db.prepare(`
    SELECT lineage_root_snapshot_id AS lineageRootSnapshotId
    FROM skill_sources
    WHERE id = ?
    LIMIT 1
  `)
    .bind(sourceId)
    .first<{ lineageRootSnapshotId: string | null }>();

  return result?.lineageRootSnapshotId ?? null;
}

async function syncSkillVersion(
  params: {
    db: D1Database;
    source: SkillSourceRecord;
    snapshotId: string;
    commitSha: string;
    commitAt: number | null;
    versionStartedAt: number | null;
    relationType: 'canonical' | 'modified_from' | 'historical_copy_of';
  }
): Promise<SkillVersionRecord> {
  const now = Date.now();

  if (params.source.currentSnapshotId === params.snapshotId && params.source.latestVersionId) {
    await params.db.prepare(`
      UPDATE skill_versions
      SET
        relation_type = ?,
        indexed_at = ?,
        is_provisional = 1
      WHERE id = ?
    `)
      .bind(params.relationType, now, params.source.latestVersionId)
      .run();

    return {
      id: params.source.latestVersionId,
      sourceId: params.source.id,
      snapshotId: params.snapshotId,
      previousVersionId: params.source.latestVersionId,
      commitSha: params.commitSha,
      relationType: params.relationType,
    };
  }

  const existing = await params.db.prepare(`
    SELECT
      id,
      previous_version_id AS previousVersionId
    FROM skill_versions
    WHERE source_id = ?
      AND commit_sha = ?
    LIMIT 1
  `)
    .bind(params.source.id, params.commitSha)
    .first<{ id: string; previousVersionId: string | null }>();

  if (existing) {
    await params.db.prepare(`
      UPDATE skill_versions
      SET
        snapshot_id = ?,
        previous_version_id = COALESCE(previous_version_id, ?),
        commit_at = COALESCE(?, commit_at),
        version_started_at = COALESCE(?, version_started_at),
        indexed_at = ?,
        relation_type = ?,
        is_provisional = 1
      WHERE id = ?
    `)
      .bind(
        params.snapshotId,
        params.source.latestVersionId,
        params.commitAt,
        params.versionStartedAt,
        now,
        params.relationType,
        existing.id
      )
      .run();

    return {
      id: existing.id,
      sourceId: params.source.id,
      snapshotId: params.snapshotId,
      previousVersionId: existing.previousVersionId,
      commitSha: params.commitSha,
      relationType: params.relationType,
    };
  }

  const versionId = generateId();
  await params.db.prepare(`
    INSERT INTO skill_versions (
      id,
      source_id,
      snapshot_id,
      previous_version_id,
      commit_sha,
      commit_at,
      version_started_at,
      indexed_at,
      relation_type,
      is_provisional,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `)
    .bind(
      versionId,
      params.source.id,
      params.snapshotId,
      params.source.latestVersionId,
      params.commitSha,
      params.commitAt,
      params.versionStartedAt,
      now,
      params.relationType,
      now
    )
    .run();

  return {
    id: versionId,
    sourceId: params.source.id,
    snapshotId: params.snapshotId,
    previousVersionId: params.source.latestVersionId,
    commitSha: params.commitSha,
    relationType: params.relationType,
  };
}

async function updateSkillSourceState(
  db: D1Database,
  input: {
    sourceId: string;
    visibleSkillId: string | null;
    currentSnapshotId: string;
    currentCommitSha: string;
    latestVersionId: string;
    lineageRootSnapshotId: string | null;
  }
): Promise<void> {
  await db.prepare(`
    UPDATE skill_sources
    SET
      visible_skill_id = ?,
      current_snapshot_id = ?,
      current_commit_sha = ?,
      latest_version_id = ?,
      lineage_root_snapshot_id = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      input.visibleSkillId,
      input.currentSnapshotId,
      input.currentCommitSha,
      input.latestVersionId,
      input.lineageRootSnapshotId,
      Date.now(),
      input.sourceId
    )
    .run();
}

async function clearSkillSourceVisibleSkillId(
  db: D1Database,
  sourceId: string
): Promise<void> {
  await db.prepare(`
    UPDATE skill_sources
    SET
      visible_skill_id = NULL,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(Date.now(), sourceId)
    .run();
}

async function updateSnapshotCanonicalState(
  db: D1Database,
  input: {
    snapshotId: string;
    canonicalSourceId: string;
    canonicalSkillId: string | null;
    canonicalSlug: string | null;
    canonicalRepoOwner: string;
    canonicalRepoName: string;
    canonicalSkillPath: string | null;
    canonicalVersionId: string;
    canonicalCommitSha: string;
    canonicalCommitAt: number | null;
  }
): Promise<void> {
  await db.prepare(`
    UPDATE skill_snapshots
    SET
      canonical_source_id = ?,
      canonical_skill_id = ?,
      canonical_slug = ?,
      canonical_repo_owner = ?,
      canonical_repo_name = ?,
      canonical_skill_path = ?,
      canonical_version_id = ?,
      canonical_commit_sha = ?,
      canonical_commit_at = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      input.canonicalSourceId,
      input.canonicalSkillId,
      input.canonicalSlug,
      input.canonicalRepoOwner,
      input.canonicalRepoName,
      input.canonicalSkillPath || '',
      input.canonicalVersionId,
      input.canonicalCommitSha,
      input.canonicalCommitAt,
      Date.now(),
      input.snapshotId
    )
    .run();
}

async function updateVisibleSkillLineageMetadata(
  db: D1Database,
  input: {
    skillId: string;
    sourceId: string;
    currentSnapshotId: string;
    currentVersionId: string;
    origin: SkillOriginMetadata;
  }
): Promise<void> {
  await db.prepare(`
    UPDATE skills
    SET
      source_id = ?,
      current_snapshot_id = ?,
      current_version_id = ?,
      origin_skill_id = ?,
      origin_slug = ?,
      origin_repo_owner = ?,
      origin_repo_name = ?,
      origin_skill_path = ?,
      origin_commit_sha = ?,
      origin_relation_type = ?
    WHERE id = ?
  `)
    .bind(
      input.sourceId,
      input.currentSnapshotId,
      input.currentVersionId,
      input.origin.originSkillId,
      input.origin.originSlug,
      input.origin.originRepoOwner,
      input.origin.originRepoName,
      input.origin.originSkillPath,
      input.origin.originCommitSha,
      input.origin.originRelationType,
      input.skillId
    )
    .run();
}

/**
 * Get stored blob SHAs from previous indexed file structure.
 */
export function extractStoredFileShas(
  fileStructure: string | null,
  repoLabel: string
): Map<string, string> {
  const shas = new Map<string, string>();

  if (!fileStructure) {
    return shas;
  }

  try {
    const parsed = JSON.parse(fileStructure) as { files?: Array<{ path?: string; sha?: string }> };
    for (const file of parsed.files || []) {
      if (file.path && file.sha) {
        shas.set(file.path, file.sha);
      }
    }
  } catch (err) {
    log.warn(`Failed to parse stored file_structure for ${repoLabel}:`, err);
  }

  return shas;
}

/**
 * Fetch all files from skill directory using GitHub Tree API
 */
async function fetchDirectoryFiles(
  owner: string,
  name: string,
  skillPath: string | null,
  treeData: GitHubTreeResponse,
  env: IndexingEnv,
  previousFileShas?: Map<string, string>
): Promise<{ files: DirectoryFile[]; textContents: Map<string, string> }> {
  const files: DirectoryFile[] = [];
  const textContents = new Map<string, string>();

  let fileCount = 0;
  let totalSize = 0;
  let reusedFromR2 = 0;

  for (const item of treeData.tree) {
    if (fileCount >= MAX_FILES) {
      log.log(`Reached max file limit (${MAX_FILES})`);
      break;
    }

    if (item.type !== 'blob') continue;

    // Filter by skill path prefix
    const relativePath = resolveSkillRelativePath(item.path, skillPath);
    if (!relativePath) continue;

    const fileSize = item.size || 0;

    // Skip files larger than max size
    if (fileSize > MAX_FILE_SIZE) {
      log.log(`Skipping large file: ${relativePath} (${fileSize} bytes)`);
      continue;
    }

    // Check total size limit
    if (totalSize + fileSize > MAX_TOTAL_SIZE) {
      log.log(`Reached total size limit (${MAX_TOTAL_SIZE})`);
      break;
    }

    const isText = isTextFile(relativePath);

    const fileInfo: DirectoryFile = {
      path: relativePath,
      sha: item.sha,
      size: fileSize,
      type: isText ? 'text' : 'binary',
    };

    files.push(fileInfo);
    fileCount++;
    totalSize += fileSize;

    // Fetch content for text files only
    if (isText) {
      const previousSha = previousFileShas?.get(relativePath);
      if (previousSha && previousSha === item.sha) {
        for (const candidateKey of buildGithubSkillR2Keys(owner, name, skillPath, relativePath)) {
          const cachedObject = await env.R2.get(candidateKey);
          if (!cachedObject) continue;
          textContents.set(relativePath, await cachedObject.text());
          reusedFromR2++;
          break;
        }

        if (textContents.has(relativePath)) {
          continue;
        }
      }

      const blobUrl = `https://api.github.com/repos/${owner}/${name}/git/blobs/${item.sha}`;
      const blobData = await githubFetch<{ content: string; encoding: string }>(blobUrl, {
        ...getGitHubRequestAuthFromEnv(env),
        apiVersion: env.GITHUB_API_VERSION,
        userAgent: 'SkillsCat-Indexing-Worker/1.0',
      });

      if (blobData && blobData.content) {
        try {
          const content = decodeBase64ToUtf8(blobData.content);
          textContents.set(relativePath, content);
        } catch (err) {
          log.warn(`Failed to decode content for ${relativePath}:`, err);
        }
      }
    }
  }

  if (reusedFromR2 > 0) {
    log.log(`Reused ${reusedFromR2} text files from R2 cache by blob SHA`);
  }
  log.log(`Fetched ${files.length} files (${textContents.size} text, ${files.length - textContents.size} binary), total size: ${totalSize} bytes`);

  return { files, textContents };
}

/**
 * Cache directory files to R2
 */
async function cacheDirectoryFiles(
  skillId: string,
  owner: string,
  name: string,
  skillPath: string | null,
  textContents: Map<string, string>,
  commitSha: string,
  directoryFiles: DirectoryFile[],
  env: IndexingEnv
): Promise<void> {
  const r2Prefix = buildGithubSkillR2Prefix(owner, name, skillPath);
  if (!r2Prefix) {
    throw new Error(`Unable to build GitHub skill R2 prefix for ${owner}/${name}`);
  }
  const fileByPath = new Map(directoryFiles.map((file) => [file.path, file]));

  for (const [relativePath, content] of textContents) {
    const r2Path = `${r2Prefix}${relativePath}`;
    const fileMeta = fileByPath.get(relativePath);

    await env.R2.put(r2Path, content, {
      httpMetadata: {
        contentType: 'text/plain',
      },
      customMetadata: {
        skillId,
        commitSha,
        blobSha: fileMeta?.sha || '',
        indexedAt: new Date().toISOString(),
      },
    });
  }

  log.log(`Cached ${textContents.size} text files to R2 with prefix: ${r2Prefix}`);
}

async function updateSkillMetadata(
  skillId: string,
  commitSha: string,
  fileStructure: FileStructure,
  lastCommitAt: number | null,
  env: IndexingEnv
): Promise<void> {
  const updatedAt = lastCommitAt ?? null;

  await env.DB.prepare(`
    UPDATE skills SET
      commit_sha = ?,
      file_structure = ?,
      last_commit_at = COALESCE(?, last_commit_at),
      updated_at = COALESCE(?, updated_at)
    WHERE id = ?
  `)
    .bind(commitSha, JSON.stringify(fileStructure), lastCommitAt, updatedAt, skillId)
    .run();

  log.log(`Updated skill metadata: ${skillId}, commitSha: ${commitSha}, files: ${fileStructure.files.length}, lastCommitAt: ${lastCommitAt}`);
}

async function getRepoInfo(
  owner: string,
  name: string,
  env: IndexingEnv
): Promise<GitHubRepo | null> {
  return githubFetch<GitHubRepo>(getRepoApiUrl(owner, name), {
    ...getGitHubRequestAuthFromEnv(env),
    apiVersion: env.GITHUB_API_VERSION,
    userAgent: 'SkillsCat-Indexing-Worker/1.0',
  });
}

async function getRepoInfoCached(
  owner: string,
  name: string,
  env: IndexingEnv,
  batchContext: IndexingBatchContext
): Promise<GitHubRepo | null> {
  return getOrCreateBatchPromise(
    batchContext.repoInfoByRepo,
    getRepoCacheKey(owner, name),
    () => getRepoInfo(owner, name, env)
  );
}

async function getSkillMd(
  owner: string,
  name: string,
  env: IndexingEnv,
  skillPath?: string
): Promise<GitHubContent | null> {
  const basePath = skillPath ? `${skillPath}/` : '';
  const paths = [`${basePath}SKILL.md`, `${basePath}skill.md`];

  for (const path of paths) {
    const content = await githubFetch<GitHubContent>(
      getContentsApiUrl(owner, name, path),
      {
        ...getGitHubRequestAuthFromEnv(env),
        apiVersion: env.GITHUB_API_VERSION,
        userAgent: 'SkillsCat-Indexing-Worker/1.0',
      }
    );
    if (content && content.type === 'file') {
      return content;
    }
  }

  return null;
}

interface SkillPersistenceMetadata {
  contentHash: string;
  lastCommitAt: number | null;
  skillMdFirstCommitAt: number | null;
  repoCreatedAt: number | null;
}

function preferEarlierTimestamp(existing: number | null, incoming: number | null): number | null {
  if (typeof existing !== 'number') return incoming;
  if (typeof incoming !== 'number') return existing;
  return Math.min(existing, incoming);
}

export function mergeSkillPersistenceMetadata(
  existing: Pick<ExistingSkillSnapshot, 'lastCommitAt' | 'skillMdFirstCommitAt' | 'repoCreatedAt'> | null,
  incoming: SkillPersistenceMetadata
): SkillPersistenceMetadata {
  return {
    contentHash: incoming.contentHash,
    lastCommitAt: incoming.lastCommitAt ?? existing?.lastCommitAt ?? null,
    skillMdFirstCommitAt: preferEarlierTimestamp(
      existing?.skillMdFirstCommitAt ?? null,
      incoming.skillMdFirstCommitAt
    ),
    repoCreatedAt: preferEarlierTimestamp(
      existing?.repoCreatedAt ?? null,
      incoming.repoCreatedAt
    ),
  };
}

async function upsertAuthor(
  repo: GitHubRepo,
  env: IndexingEnv
): Promise<string> {
  const authorId = `github-${repo.owner.id}`;
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO authors (id, github_id, username, avatar_url, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `)
    .bind(
      authorId,
      repo.owner.id,
      repo.owner.login,
      repo.owner.avatar_url,
      repo.owner.type,
      now,
      now
    )
    .run();

  return authorId;
}

async function createSkill(
  repo: GitHubRepo,
  skillMetadata: ResolvedSkillMetadata,
  env: IndexingEnv,
  persistenceMetadata: SkillPersistenceMetadata,
  commitSha: string,
  fileStructure: FileStructure,
  skillPath?: string,
  frontmatter?: SkillFrontmatter | null
): Promise<{ id: string; slug: string; createdAt: number; existingSnapshot?: ExistingSkillSnapshot }> {
  const skillId = generateId();
  const now = Date.now();
  const updatedAt = persistenceMetadata.lastCommitAt ?? now;
  const serializedFileStructure = JSON.stringify(fileStructure);
  const { name, description } = skillMetadata;

  const normalizedPath = skillPath || '';
  const baseSlug = generateSlug(repo.owner.login, repo.name, normalizedPath || undefined);
  const slugCandidates: string[] = [];

  if (normalizedPath && frontmatter?.name) {
    slugCandidates.push(generateSlug(repo.owner.login, repo.name, normalizedPath, frontmatter.name));
  }
  slugCandidates.push(baseSlug);

  const repoSuffix = repo.id.toString(36);
  slugCandidates.push(`${baseSlug}-${repoSuffix}`);
  for (let i = 2; i <= 10; i++) {
    slugCandidates.push(`${baseSlug}-${repoSuffix}-${i}`);
  }

  const seen = new Set<string>();

  for (const candidateSlug of slugCandidates) {
    if (seen.has(candidateSlug)) continue;
    seen.add(candidateSlug);

    try {
      await env.DB.prepare(`
        INSERT INTO skills (
          id, name, slug, description, repo_owner, repo_name, skill_path, github_url,
          stars, forks, trending_score, content_hash, commit_sha, file_structure,
          last_commit_at, skill_md_first_commit_at, repo_created_at, created_at, updated_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          skillId,
          name,
          candidateSlug,
          description,
          repo.owner.login,
          repo.name,
          normalizedPath,
          repo.html_url,
          repo.stargazers_count,
          repo.forks_count,
          0,
          persistenceMetadata.contentHash,
          commitSha,
          serializedFileStructure,
          persistenceMetadata.lastCommitAt,
          persistenceMetadata.skillMdFirstCommitAt,
          persistenceMetadata.repoCreatedAt,
          now,
          updatedAt,
          now
        )
        .run();

      return {
        id: skillId,
        slug: candidateSlug,
        createdAt: now,
      };
    } catch (error) {
      const message = String(error);

      if (message.includes('skills_repo_path_unique') || (message.includes('repo_owner') && message.includes('repo_name'))) {
        const existing = await getExistingSkillSnapshot(
          repo.owner.login,
          repo.name,
          normalizedPath,
          env
        );

        if (existing?.id) {
          return {
            id: existing.id,
            slug: existing.slug,
            createdAt: existing.createdAt,
            existingSnapshot: existing,
          };
        }
      }

      if (message.includes('skills_slug_unique') || message.includes('skills.slug')) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Unable to create unique slug for ${repo.owner.login}/${repo.name}${normalizedPath ? `/${normalizedPath}` : ''}`);
}

async function updateSkill(
  skillId: string,
  repo: GitHubRepo,
  skillMetadata: ResolvedSkillMetadata,
  persistenceMetadata: SkillPersistenceMetadata,
  commitSha: string,
  fileStructure: FileStructure,
  env: IndexingEnv
): Promise<string | null> {
  const now = Date.now();
  const updatedAt = persistenceMetadata.lastCommitAt ?? now;
  const serializedFileStructure = JSON.stringify(fileStructure);

  const result = await env.DB.prepare(`
    UPDATE skills SET
      name = ?,
      description = ?,
      stars = ?,
      forks = ?,
      content_hash = ?,
      commit_sha = ?,
      file_structure = ?,
      last_commit_at = COALESCE(?, last_commit_at),
      skill_md_first_commit_at = ?,
      repo_created_at = ?,
      indexed_at = ?,
      updated_at = COALESCE(?, updated_at)
    WHERE id = ?
    RETURNING id
  `)
    .bind(
      skillMetadata.name,
      skillMetadata.description,
      repo.stargazers_count,
      repo.forks_count,
      persistenceMetadata.contentHash,
      commitSha,
      serializedFileStructure,
      persistenceMetadata.lastCommitAt,
      persistenceMetadata.skillMdFirstCommitAt,
      persistenceMetadata.repoCreatedAt,
      now,
      updatedAt,
      skillId,
    )
    .first<{ id: string }>();

  return result?.id || null;
}

async function updateSkillMetricsOnly(
  skillId: string,
  repo: GitHubRepo,
  env: IndexingEnv
): Promise<string | null> {
  const now = Date.now();

  const result = await env.DB.prepare(`
    UPDATE skills SET
      stars = ?,
      forks = ?,
      indexed_at = ?
    WHERE id = ?
    RETURNING id
  `)
    .bind(
      repo.stargazers_count,
      repo.forks_count,
      now,
      skillId,
    )
    .first<{ id: string }>();

  return result?.id || null;
}

export async function syncRepoMetricsForGithubSkills(
  db: IndexingEnv['DB'],
  owner: string,
  name: string,
  stars: number,
  forks: number
): Promise<void> {
  await db.prepare(`
    UPDATE skills
    SET stars = ?,
        forks = ?
    WHERE source_type = 'github'
      AND repo_owner = ?
      AND repo_name = ?
      AND (
        COALESCE(stars, -1) != ?
        OR COALESCE(forks, -1) != ?
      )
  `)
    .bind(stars, forks, owner, name, stars, forks)
    .run();
}

/**
 * Save skill tags from frontmatter to the database
 */
async function saveSkillTags(
  skillId: string,
  tagsString: string,
  env: IndexingEnv
): Promise<string[]> {
  const tags = normalizeTags(tagsString);

  if (tags.length === 0) return [];

  const now = Date.now();

  for (const tag of tags) {
    await env.DB.prepare(`
      INSERT INTO skill_tags (skill_id, tag, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(skill_id, tag) DO NOTHING
    `)
      .bind(skillId, tag, now)
      .run();
  }

  log.log(`Saved ${tags.length} tags for skill ${skillId}: ${tags.join(', ')}`);
  return tags;
}

/**
 * Extract categories from frontmatter for direct classification
 * Checks category, categories, metadata.category, metadata.categories
 */
function normalizeFrontmatterCategories(rawValue: string): string[] {
  return normalizeTags(rawValue)
    .map((value) => canonicalizeCategorySlug(value) ?? value)
    .filter(Boolean);
}

export function extractFrontmatterCategories(frontmatter: SkillFrontmatter | null): string[] {
  if (!frontmatter) return [];

  const categories: string[] = [];

  // Check root level category (single)
  if (frontmatter.category) {
    categories.push(...normalizeFrontmatterCategories(frontmatter.category));
  }

  // Check root level categories (multiple)
  if (frontmatter.categories) {
    categories.push(...normalizeFrontmatterCategories(frontmatter.categories));
  }

  // Check metadata.category as fallback
  if (frontmatter.metadata?.category && categories.length === 0) {
    categories.push(...normalizeFrontmatterCategories(frontmatter.metadata.category));
  }

  // Check metadata.categories as fallback
  if (frontmatter.metadata?.categories && categories.length === 0) {
    categories.push(...normalizeFrontmatterCategories(frontmatter.metadata.categories));
  }

  // Deduplicate and return
  return [...new Set(categories)].filter(Boolean);
}

function getMessageDedupKey(message: IndexingMessage): string {
  const owner = message.repoOwner.toLowerCase();
  const repo = message.repoName.toLowerCase();
  const path = (message.skillPath || '').toLowerCase();
  return `${owner}/${repo}:${path}`;
}

function shouldProcessDuplicateBatchMessage(
  currentMessage: IndexingMessage,
  existingState: { queuedAsPending: boolean } | undefined
): boolean {
  if (!existingState || currentMessage.forceReindex) {
    return true;
  }

  // Allow a pending-backed discovery message to run even when a non-pending
  // duplicate for the same candidate already appeared earlier in the batch.
  // This lets the pending-backed path clean up its KV marker or take over if
  // the earlier representative fails.
  if (currentMessage.queuedAsPending && !existingState.queuedAsPending) {
    return true;
  }

  return false;
}

function buildProcessedCandidateKey(
  owner: string,
  repo: string,
  skillPath: string | null | undefined,
  headSha: string
): string {
  return `indexing:processed:${owner.toLowerCase()}/${repo.toLowerCase()}:${(skillPath || '').toLowerCase()}:${headSha.toLowerCase()}`;
}

function buildPendingCandidateKey(
  owner: string,
  repo: string,
  skillPath: string | null | undefined,
  headSha: string
): string {
  return `indexing:pending:${owner.toLowerCase()}/${repo.toLowerCase()}:${(skillPath || '').toLowerCase()}:${headSha.toLowerCase()}`;
}

function buildRepoMetricsSyncedKey(
  owner: string,
  repo: string,
  headSha: string,
  stars: number,
  forks: number
): string {
  return `indexing:repo-metrics:${owner.toLowerCase()}/${repo.toLowerCase()}:${headSha.toLowerCase()}:${stars}:${forks}`;
}

async function wasCandidateProcessed(env: IndexingEnv, key: string): Promise<boolean> {
  return (await env.KV.get(key)) !== null;
}

async function markCandidateProcessed(env: IndexingEnv, key: string): Promise<void> {
  await env.KV.put(key, '1', {
    expirationTtl: INDEXING_PROCESSED_TTL_SECONDS,
  });
}

async function wasCandidatePending(env: IndexingEnv, key: string): Promise<boolean> {
  return (await env.KV.get(key)) !== null;
}

async function markCandidatePending(env: IndexingEnv, key: string): Promise<void> {
  await env.KV.put(key, '1', {
    expirationTtl: INDEXING_PENDING_TTL_SECONDS,
  });
}

async function clearCandidatePending(env: IndexingEnv, key: string): Promise<void> {
  await env.KV.delete(key);
}

async function wasRepoMetricsSynced(env: IndexingEnv, key: string): Promise<boolean> {
  return (await env.KV.get(key)) !== null;
}

async function markRepoMetricsSynced(env: IndexingEnv, key: string): Promise<void> {
  await env.KV.put(key, '1', {
    expirationTtl: INDEXING_PROCESSED_TTL_SECONDS,
  });
}

export async function queueDiscoveredSkillPaths(
  message: IndexingMessage,
  owner: string,
  repo: string,
  headSha: string,
  skillPaths: string[],
  env: IndexingEnv
): Promise<number> {
  let queued = 0;
  const shouldUsePendingMarker = !message.forceReindex;

  for (const discoveredSkillPath of skillPaths) {
    if (!discoveredSkillPath) continue;

    const processedKey = buildProcessedCandidateKey(owner, repo, discoveredSkillPath, headSha);
    const pendingKey = buildPendingCandidateKey(owner, repo, discoveredSkillPath, headSha);
    if (shouldUsePendingMarker && (
      await wasCandidateProcessed(env, processedKey)
      || await wasCandidatePending(env, pendingKey)
    )) {
      continue;
    }

    if (shouldUsePendingMarker) {
      await markCandidatePending(env, pendingKey);
    }

    try {
      await env.INDEXING_QUEUE.send({
        type: 'check_skill',
        repoOwner: owner,
        repoName: repo,
        skillPath: discoveredSkillPath,
        submittedBy: message.submittedBy,
        submittedAt: message.submittedAt,
        forceReindex: message.forceReindex,
        queuedAsPending: shouldUsePendingMarker,
        discoverySource: message.discoverySource,
        discoveryFingerprint: message.discoveryFingerprint,
      });
      queued++;
    } catch (error) {
      if (shouldUsePendingMarker) {
        await clearCandidatePending(env, pendingKey);
      }
      throw error;
    }
  }

  return queued;
}

async function processMessage(
  message: IndexingMessage,
  env: IndexingEnv,
  batchContext: IndexingBatchContext
): Promise<void> {
  const { repoOwner, repoName, skillPath, forceReindex } = message;
  const source = message.submittedBy ? 'user-submit' : (message.discoverySource || 'github-events');

  log.log(`Processing repo: ${repoOwner}/${repoName} (source: ${source}, skillPath: ${skillPath || 'root'})`, JSON.stringify(message));

  // Step 1: Get repository info
  const repo = await getRepoInfoCached(repoOwner, repoName, env, batchContext);
  if (!repo) {
    log.log(`Repo not found: ${repoOwner}/${repoName}`);
    return;
  }

  if (repo.fork) {
    log.log(`Skipping fork: ${repoOwner}/${repoName}`);
    return;
  }

  const canonicalRepoOwner = repo.owner?.login || repoOwner;
  const canonicalRepoName = repo.name || repoName;

  if (canonicalRepoOwner !== repoOwner || canonicalRepoName !== repoName) {
    log.log(`Canonicalized repository identity: ${repoOwner}/${repoName} -> ${canonicalRepoOwner}/${canonicalRepoName}`);
  }

  log.log(`Repo info fetched: ${canonicalRepoOwner}/${canonicalRepoName}, stars: ${repo.stargazers_count}, fork: ${repo.fork}`);

  // Step 2: Get latest commit SHA
  const latestCommit = await getOrCreateBatchPromise(
    batchContext.latestCommitByRepoRef,
    getRepoRefCacheKey(canonicalRepoOwner, canonicalRepoName, repo.default_branch || 'main'),
    () => getLatestCommitSha(
      canonicalRepoOwner,
      canonicalRepoName,
      env,
      repo.default_branch
    )
  );
  if (!latestCommit) {
    log.log(`Failed to get latest commit SHA: ${canonicalRepoOwner}/${canonicalRepoName}`);
    return;
  }

  log.log(`Latest commit: ${latestCommit.sha} (branch: ${latestCommit.branch})`);

  const processedCandidateKey = buildProcessedCandidateKey(
    canonicalRepoOwner,
    canonicalRepoName,
    skillPath || null,
    latestCommit.sha
  );
  const pendingCandidateKey = buildPendingCandidateKey(
    canonicalRepoOwner,
    canonicalRepoName,
    skillPath || null,
    latestCommit.sha
  );
  if (!forceReindex && await wasCandidateProcessed(env, processedCandidateKey)) {
    if (message.queuedAsPending) {
      await clearCandidatePending(env, pendingCandidateKey);
    }
    log.log(`Skipping exact candidate already processed: ${processedCandidateKey}`);
    return;
  }

  let shouldMarkProcessed = false;
  let discoveredRepositorySkillPaths: string[] | null = null;
  let repositoryTree: GitHubTreeResponse | null = null;

  try {
    if (!skillPath) {
      try {
        repositoryTree = await getRepositoryTreeCached(
          canonicalRepoOwner,
          canonicalRepoName,
          latestCommit.branch,
          env,
          batchContext
        );
        discoveredRepositorySkillPaths = scanRepositorySkillPathsFromTree(repositoryTree);
        const queuedDiscoveredPaths = await queueDiscoveredSkillPaths(
          message,
          canonicalRepoOwner,
          canonicalRepoName,
          latestCommit.sha,
          discoveredRepositorySkillPaths.filter(Boolean),
          env
        );
        if (queuedDiscoveredPaths > 0) {
          log.log(`Queued ${queuedDiscoveredPaths} discovered nested skill paths for ${canonicalRepoOwner}/${canonicalRepoName}`);
        }
      } catch (scanError) {
        log.warn(`Failed to scan repository skill paths for ${canonicalRepoOwner}/${canonicalRepoName}`, scanError);
      }
    }

    // Step 3: Load the stored source/skill state once and derive update decisions from it.
    const existingSource = await getExistingSourceState(
      canonicalRepoOwner,
      canonicalRepoName,
      skillPath || null,
      env
    );
    const existingSkill = await getExistingSkillSnapshot(
      canonicalRepoOwner,
      canonicalRepoName,
      skillPath || null,
      env
    );
    const storedCommitSha = getStoredSourceCommitSha(existingSource) || existingSkill?.commitSha || null;
    const shouldFetchContent = forceReindex
      || !storedCommitSha
      || storedCommitSha !== latestCommit.sha;

    if (forceReindex) {
      log.log(`Force reindex requested for ${canonicalRepoOwner}/${canonicalRepoName}`);
    } else if (!storedCommitSha) {
      log.log(`No stored commit SHA for ${canonicalRepoOwner}/${canonicalRepoName}, needs full index`);
    } else if (storedCommitSha !== latestCommit.sha) {
      log.log(`Commit SHA changed: ${storedCommitSha} -> ${latestCommit.sha}`);
    } else {
      log.log(`Commit SHA unchanged: ${latestCommit.sha}, skipping content fetch`);
    }

    const repoMetricsSyncKey = buildRepoMetricsSyncedKey(
      canonicalRepoOwner,
      canonicalRepoName,
      latestCommit.sha,
      repo.stargazers_count,
      repo.forks_count
    );

    // If content is unchanged, we only need the cheap repo-metric sync path.
    if (!shouldFetchContent) {
      if (existingSkill) {
        const updatedId = await updateSkillMetricsOnly(
          existingSkill.id,
          repo,
          env
        );
        if (updatedId) {
          log.log(`Updated stars/forks only for skill: ${updatedId}`);
        }
      }

      if (!await wasRepoMetricsSynced(env, repoMetricsSyncKey)) {
        await syncRepoMetricsForGithubSkills(
          env.DB,
          canonicalRepoOwner,
          canonicalRepoName,
          repo.stargazers_count,
          repo.forks_count
        );
        await markRepoMetricsSynced(env, repoMetricsSyncKey);
      }

      shouldMarkProcessed = true;
      return;
    }

    // Step 4: Verify SKILL.md exists for the requested path.
    let skillMd = await getSkillMd(canonicalRepoOwner, canonicalRepoName, env, skillPath);
    if (!skillMd && !skillPath) {
      const repositorySkillPaths = discoveredRepositorySkillPaths || await scanRepositorySkillPaths(
        canonicalRepoOwner,
        canonicalRepoName,
        latestCommit.branch,
        env,
        batchContext
      );
      const discoveredSkillPaths = repositorySkillPaths.filter((candidatePath) => candidatePath);

      if (!repositorySkillPaths.includes('')) {
        if (discoveredRepositorySkillPaths === null && discoveredSkillPaths.length > 0) {
          const queuedDiscoveredPaths = await queueDiscoveredSkillPaths(
            message,
            canonicalRepoOwner,
            canonicalRepoName,
            latestCommit.sha,
            discoveredSkillPaths,
            env
          );
          if (queuedDiscoveredPaths > 0) {
            log.log(`Queued ${queuedDiscoveredPaths} discovered skill paths for ${canonicalRepoOwner}/${canonicalRepoName}`);
          }
        }

        if (discoveredSkillPaths.length === 0) {
          log.log(`No SKILL.md found anywhere in repository: ${canonicalRepoOwner}/${canonicalRepoName}`);
        } else {
          log.log(`No root SKILL.md found in repository ${canonicalRepoOwner}/${canonicalRepoName}; nested skills were queued separately`);
        }
        shouldMarkProcessed = true;
        return;
      }
    }

    if (!skillMd) {
      log.log(`No SKILL.md found: ${canonicalRepoOwner}/${canonicalRepoName}${skillPath ? `/${skillPath}` : ''}`);
      shouldMarkProcessed = true;
      return;
    }

    log.log(`SKILL.md found: ${canonicalRepoOwner}/${canonicalRepoName}, path: ${skillMd.path}`);

    // Step 5: Fetch all files from directory using Tree API
    let directoryFiles: DirectoryFile[] = [];
    let textContents = new Map<string, string>();
    const previousFileShas = existingSkill
      ? extractStoredFileShas(
        existingSkill.fileStructure,
        `${canonicalRepoOwner}/${canonicalRepoName}${skillPath ? `/${skillPath}` : ''}`
      )
      : undefined;

    try {
      const treeForDirectory = repositoryTree || await getRepositoryTreeCached(
        canonicalRepoOwner,
        canonicalRepoName,
        latestCommit.branch,
        env,
        batchContext
      );
      const result = await fetchDirectoryFiles(
        canonicalRepoOwner,
        canonicalRepoName,
        skillPath || null,
        treeForDirectory,
        env,
        previousFileShas
      );
      directoryFiles = result.files;
      textContents = result.textContents;
    } catch (err) {
      log.error(`Failed to fetch directory files: ${canonicalRepoOwner}/${canonicalRepoName}`, err);
      // Fallback: just use SKILL.md content
      let skillMdContent = '';
      if (skillMd.content) {
        skillMdContent = decodeBase64ToUtf8(skillMd.content);
      } else if (skillMd.download_url) {
        const response = await githubRequest(skillMd.download_url, {
          ...getGitHubRequestAuthFromEnv(env),
          apiVersion: env.GITHUB_API_VERSION,
          userAgent: 'SkillsCat-Worker/1.0',
        });
        skillMdContent = await response.text();
      }
      textContents.set('SKILL.md', skillMdContent);
      directoryFiles = [{
        path: 'SKILL.md',
        sha: skillMd.sha,
        size: skillMdContent.length,
        type: 'text',
      }];
    }

    // Get SKILL.md content for parsing
    const skillMdContent = textContents.get('SKILL.md') || textContents.get('skill.md') || '';
    if (!skillMdContent) {
      log.error('SKILL.md content not found in fetched files');
      shouldMarkProcessed = true;
      return;
    }

    log.log(`SKILL.md content length: ${skillMdContent.length} chars`);

    // Step 6: Parse YAML frontmatter
    const parsedSkillMd = parseSkillFrontmatter(skillMdContent);
    const { frontmatter } = parsedSkillMd;
    if (frontmatter) {
      log.log(`Frontmatter parsed: name=${frontmatter.name}, description=${frontmatter.description?.slice(0, 50)}..., tags=${frontmatter.metadata?.tags}`);
    }

    const skillMetadata = resolveSkillMetadata(repo, parsedSkillMd);
    const { fullHash, normalizedHash } = await computeSkillMdHashes(skillMdContent);
    const exactBundleFingerprint = await computeExactBundleFingerprint(directoryFiles);
    const bundleManifestHash = await computeBundleManifestHash(directoryFiles, normalizedHash);
    const { lastCommitAt, firstCommitAt } = await getOrCreateBatchPromise(
      batchContext.skillCommitDatesByPath,
      getSkillCommitDatesCacheKey(canonicalRepoOwner, canonicalRepoName, skillMd.path),
      () => getSkillCommitDates(
        canonicalRepoOwner,
        canonicalRepoName,
        skillMd.path,
        env
      )
    );
    const persistenceMetadata: SkillPersistenceMetadata = {
      contentHash: fullHash,
      lastCommitAt,
      skillMdFirstCommitAt: firstCommitAt,
      repoCreatedAt: repo.created_at ? new Date(repo.created_at).getTime() : null,
    };
    const mergedPersistenceMetadata = mergeSkillPersistenceMetadata(existingSkill, persistenceMetadata);
    const fileStructure: FileStructure = {
      commitSha: latestCommit.sha,
      indexedAt: new Date().toISOString(),
      files: directoryFiles,
      fileTree: buildFileTree(directoryFiles),
    };
    const securityContentFingerprint = await buildSecurityContentFingerprint(directoryFiles);

    const source = await getOrCreateSkillSource(
      canonicalRepoOwner,
      canonicalRepoName,
      skillPath || null,
      env,
      {
        visibleSkillId: existingSkill?.id ?? null,
        currentCommitSha: storedCommitSha,
      }
    );
    const snapshot = await getOrCreateSkillSnapshot({
      bundleExactFingerprint: exactBundleFingerprint,
      bundleSemanticFingerprint: bundleManifestHash,
      skillMdBlobSha: skillMd.sha || null,
      skillMdNormalizedSha256: normalizedHash,
    }, env.DB);
    const snapshotState = await getSnapshotCanonicalStateByExactFingerprint(
      exactBundleFingerprint,
      env.DB
    );
    if (!snapshotState) {
      throw new Error(`Failed to reload skill snapshot ${exactBundleFingerprint}`);
    }

    const currentCanonicalCandidate = buildCanonicalCandidateForSource({
      sourceId: source.id,
      slug: buildSourceCandidateSlug(
        canonicalRepoOwner,
        canonicalRepoName,
        skillPath || null,
        existingSkill?.slug
      ),
      repo,
      skillPath: skillPath || null,
      persistenceMetadata: mergedPersistenceMetadata,
      sourceCreatedAt: source.createdAt,
      sourceIndexedAt: Date.now(),
    });
    const existingCanonicalCandidate = buildCanonicalCandidateFromSnapshotState(snapshotState);
    const currentOwnsSnapshot = !existingCanonicalCandidate
      || existingCanonicalCandidate.id === source.id
      || compareCanonicalSkillCandidates(currentCanonicalCandidate, existingCanonicalCandidate) < 0;

    let lineageRootSnapshotId = source.lineageRootSnapshotId;
    if (!lineageRootSnapshotId) {
      if (snapshotState.canonicalSourceId && snapshotState.canonicalSourceId !== source.id) {
        lineageRootSnapshotId = snapshotState.canonicalSourceLineageRootSnapshotId
          || await getSourceLineageRootSnapshotId(snapshotState.canonicalSourceId, env.DB)
          || snapshot.id;
      } else {
        lineageRootSnapshotId = snapshot.id;
      }
    }

    const versionRelationType = determineSkillVersionRelationType({
      sourceId: source.id,
      currentSnapshotId: snapshot.id,
      lineageRootSnapshotId,
      canonicalSourceId: currentOwnsSnapshot ? source.id : snapshotState.canonicalSourceId,
    });
    const versionRecord = await syncSkillVersion({
      db: env.DB,
      source,
      snapshotId: snapshot.id,
      commitSha: latestCommit.sha,
      commitAt: mergedPersistenceMetadata.lastCommitAt ?? mergedPersistenceMetadata.skillMdFirstCommitAt,
      versionStartedAt: mergedPersistenceMetadata.lastCommitAt ?? mergedPersistenceMetadata.skillMdFirstCommitAt,
      relationType: versionRelationType,
    });

    if (!await wasRepoMetricsSynced(env, repoMetricsSyncKey)) {
      await syncRepoMetricsForGithubSkills(
        env.DB,
        canonicalRepoOwner,
        canonicalRepoName,
        repo.stargazers_count,
        repo.forks_count
      );
      await markRepoMetricsSynced(env, repoMetricsSyncKey);
    }

    if (!currentOwnsSnapshot) {
      await updateSkillSourceState(env.DB, {
        sourceId: source.id,
        visibleSkillId: null,
        currentSnapshotId: snapshot.id,
        currentCommitSha: latestCommit.sha,
        latestVersionId: versionRecord.id,
        lineageRootSnapshotId,
      });

      if (existingSkill) {
        await deleteSkillArtifactsAndInvalidateCaches({
          db: env.DB,
          r2: env.R2,
          indexNow: {
            env,
          },
          skill: {
            id: existingSkill.id,
            slug: existingSkill.slug,
            sourceType: existingSkill.sourceType,
            repoOwner: existingSkill.repoOwner,
            repoName: existingSkill.repoName,
            skillPath: existingSkill.skillPath,
          },
        });
        log.log(`Removed duplicate visible skill ${existingSkill.slug}; kept snapshot history on source ${source.id}`);
      } else {
        log.log(`Recorded duplicate-only source history for ${canonicalRepoOwner}/${canonicalRepoName}${skillPath ? `/${skillPath}` : ''}`);
      }

      shouldMarkProcessed = true;
      return;
    }

    let skillId: string | null = existingSkill?.id ?? null;
    let skillSlug: string | null = existingSkill?.slug ?? null;

    if (existingSkill) {
      const updatedId = await updateSkill(
        existingSkill.id,
        repo,
        skillMetadata,
        mergedPersistenceMetadata,
        latestCommit.sha,
        fileStructure,
        env
      );
      if (!updatedId) {
        log.error(`Failed to update skill: ${canonicalRepoOwner}/${canonicalRepoName}`);
        return;
      }
      skillId = updatedId;
      skillSlug = existingSkill.slug;
      log.log(`Updated canonical skill: ${skillId}`);
    } else {
      const curationResult = await checkAndConvertPrivateSkill(
        fullHash,
        exactBundleFingerprint,
        repo,
        skillMetadata,
        persistenceMetadata,
        latestCommit.sha,
        fileStructure,
        skillPath || null,
        env
      );

      if (curationResult.converted && curationResult.skillId) {
        skillId = curationResult.skillId;
        skillSlug = curationResult.slug || null;
        log.log(`Curation: Converted private skill to public canonical skill: ${skillSlug || skillId}`);
        await invalidatePublicDiscoveryCaches(`curation publish ${skillSlug || skillId}`);
      } else {
        const authorId = await upsertAuthor(repo, env);
        log.log(`Author upserted: ${authorId}`);
        const createResult = await createSkill(
          repo,
          skillMetadata,
          env,
          persistenceMetadata,
          latestCommit.sha,
          fileStructure,
          skillPath,
          frontmatter
        );
        skillId = createResult.id;
        skillSlug = createResult.slug;

        if (createResult.existingSnapshot) {
          const createMergedPersistenceMetadata = mergeSkillPersistenceMetadata(
            createResult.existingSnapshot,
            persistenceMetadata
          );
          const updatedId = await updateSkill(
            createResult.id,
            repo,
            skillMetadata,
            createMergedPersistenceMetadata,
            latestCommit.sha,
            fileStructure,
            env
          );
          if (!updatedId) {
            log.error(`Failed to update raced skill after create fallback: ${canonicalRepoOwner}/${canonicalRepoName}`);
            return;
          }
          skillId = updatedId;
          skillSlug = createResult.existingSnapshot.slug;
        } else {
          await invalidatePublicDiscoveryCaches(`github publish ${canonicalRepoOwner}/${canonicalRepoName}${skillPath ? `/${skillPath}` : ''}`);
        }

        log.log(`Created canonical skill: ${skillId}`);
      }
    }

    if (!skillId) {
      throw new Error(`Visible canonical skill missing for ${canonicalRepoOwner}/${canonicalRepoName}`);
    }

    const lineageRootSnapshot = lineageRootSnapshotId === snapshot.id
      ? {
        canonicalSourceId: source.id,
        canonicalSkillId: skillId,
        canonicalSlug: skillSlug,
        canonicalRepoOwner: canonicalRepoOwner,
        canonicalRepoName: canonicalRepoName,
        canonicalSkillPath: skillPath || '',
        canonicalCommitSha: latestCommit.sha,
      }
      : await getSnapshotCanonicalStateById(lineageRootSnapshotId, env.DB);
    const originMetadata = resolveVisibleSkillOriginMetadata({
      sourceId: source.id,
      currentSnapshotId: snapshot.id,
      lineageRootSnapshotId,
      lineageRootSnapshot,
    });

    await updateVisibleSkillLineageMetadata(env.DB, {
      skillId,
      sourceId: source.id,
      currentSnapshotId: snapshot.id,
      currentVersionId: versionRecord.id,
      origin: originMetadata,
    });
    await updateSkillSourceState(env.DB, {
      sourceId: source.id,
      visibleSkillId: skillId,
      currentSnapshotId: snapshot.id,
      currentCommitSha: latestCommit.sha,
      latestVersionId: versionRecord.id,
      lineageRootSnapshotId,
    });
    await updateSnapshotCanonicalState(env.DB, {
      snapshotId: snapshot.id,
      canonicalSourceId: source.id,
      canonicalSkillId: skillId,
      canonicalSlug: skillSlug,
      canonicalRepoOwner: canonicalRepoOwner,
      canonicalRepoName: canonicalRepoName,
      canonicalSkillPath: skillPath || '',
      canonicalVersionId: versionRecord.id,
      canonicalCommitSha: latestCommit.sha,
      canonicalCommitAt: mergedPersistenceMetadata.skillMdFirstCommitAt,
    });

    if (
      snapshotState.canonicalSourceId
      && snapshotState.canonicalSourceId !== source.id
      && snapshotState.candidateSkillId
      && snapshotState.candidateSlug
      && snapshotState.canonicalSourceCurrentSnapshotId === snapshot.id
      && snapshotState.canonicalSourceVisibleSkillId === snapshotState.candidateSkillId
    ) {
      await deleteSkillArtifactsAndInvalidateCaches({
        db: env.DB,
        r2: env.R2,
        indexNow: {
          env,
        },
        skill: {
          id: snapshotState.candidateSkillId,
          slug: snapshotState.candidateSlug,
          sourceType: snapshotState.candidateSourceType || 'github',
          repoOwner: snapshotState.candidateRepoOwner,
          repoName: snapshotState.candidateRepoName,
          skillPath: snapshotState.candidateSkillPath,
        },
      });
      await clearSkillSourceVisibleSkillId(env.DB, snapshotState.canonicalSourceId);
      log.log(`Replaced canonical duplicate source ${snapshotState.canonicalSourceId} with ${source.id}`);
    }

    await storeSkillHashes(env.DB, skillId, {
      fullHash,
      normalizedHash,
      bundleExactHash: exactBundleFingerprint,
      bundleManifestHash,
    });
    log.log(`Stored skill hashes for ${skillId}`);

    // Save tags from frontmatter (including keywords alias)
    let tags: string[] = [];
    const tagsString = frontmatter?.metadata?.tags || frontmatter?.keywords;
    if (tagsString) {
      tags = await saveSkillTags(skillId, tagsString, env);
    }

    // Extract categories from frontmatter for direct classification
    const frontmatterCategories = extractFrontmatterCategories(frontmatter);
    if (frontmatterCategories.length > 0) {
      log.log(`Frontmatter categories extracted: ${frontmatterCategories.join(', ')}`);
    }

    // Step 8: Cache all text files to R2
    const r2Path = buildGithubSkillR2Key(
      canonicalRepoOwner,
      canonicalRepoName,
      skillPath || null,
      'SKILL.md'
    );

    try {
      await cacheDirectoryFiles(
        skillId,
        canonicalRepoOwner,
        canonicalRepoName,
        skillPath || null,
        textContents,
        latestCommit.sha,
        directoryFiles,
        env
      );
      log.log(`Cached ${textContents.size} files to R2`);
    } catch (r2Error) {
      log.error(`Failed to cache files to R2: ${canonicalRepoOwner}/${canonicalRepoName}`, r2Error);
      throw r2Error;
    }

    await updateSkillMetadata(skillId, latestCommit.sha, fileStructure, lastCommitAt, env);

    if (isIndexNowEnabled(env)) {
      try {
        const indexNowTarget = await loadIndexNowSkillTarget(env.DB, skillId);
        if (indexNowTarget) {
          await scheduleIndexNowSubmission({
            env,
            urls: buildIndexNowSkillUrls(indexNowTarget, env),
            source: `indexing:${indexNowTarget.slug}`,
          });
        }
      } catch (indexNowError) {
        log.error(`Failed to enqueue IndexNow update for ${skillId}`, indexNowError);
      }
    }

    // Mark recommend candidates dirty after content/tags/metadata updates.
    await markRecommendDirty(env.DB, skillId);
    await markSkillSecurityDirty(env.DB, {
      skillId,
      contentFingerprint: securityContentFingerprint,
    });

    // Step 10: Send to classification queue
    const classificationMessage: ClassificationMessage & { tags?: string[] } = {
      type: 'classify',
      skillId,
      repoOwner: canonicalRepoOwner,
      repoName: canonicalRepoName,
      skillMdPath: r2Path,
    };

    if (frontmatterCategories.length > 0) {
      classificationMessage.frontmatterCategories = frontmatterCategories;
    }

    if (tags.length > 0) {
      classificationMessage.tags = tags;
    }

    log.log(`Sending to classification queue: ${skillId}`, JSON.stringify(classificationMessage));
    try {
      await env.CLASSIFICATION_QUEUE.send(classificationMessage);
      log.log(`Successfully sent to classification queue: ${skillId}`);
    } catch (classificationError) {
      log.error(`Failed to send to classification queue: ${skillId}`, classificationError);
      throw classificationError;
    }

    try {
      await queueSecurityAnalysis(
        env.SECURITY_ANALYSIS_QUEUE,
        buildSecurityAnalysisMessage(skillId, 'content_update', 'free')
      );
      log.log(`Successfully queued security analysis for: ${skillId}`);
    } catch (securityError) {
      log.error(`Failed to queue security analysis: ${skillId}`, securityError);
      throw securityError;
    }

    shouldMarkProcessed = true;
  } finally {
    if (shouldMarkProcessed && !forceReindex) {
      if (message.queuedAsPending) {
        await clearCandidatePending(env, pendingCandidateKey);
      }
      await markCandidateProcessed(env, processedCandidateKey);
    }
  }
}

export default {
  async queue(
    batch: MessageBatch<IndexingMessage>,
    env: IndexingEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    log.log(`Processing batch of ${batch.messages.length} messages`);
    const seenInBatch = new Map<string, { queuedAsPending: boolean }>();
    const batchContext = createIndexingBatchContext();

    for (const message of batch.messages) {
      const dedupKey = getMessageDedupKey(message.body);
      const seenState = seenInBatch.get(dedupKey);

      if (!shouldProcessDuplicateBatchMessage(message.body, seenState)) {
        log.log(`Skipping duplicate message in batch: ${dedupKey}`);
        message.ack();
        continue;
      }

      seenInBatch.set(dedupKey, {
        queuedAsPending: Boolean(seenState?.queuedAsPending || message.body.queuedAsPending),
      });

      try {
        if (!message.body.forceReindex) {
          log.log(`Processing deduped queue candidate: ${dedupKey}`);
        }
        log.log(`Processing message ID: ${message.id}`);
        await processMessage(message.body, env, batchContext);
        message.ack();
        log.log(`Message acknowledged: ${message.id}`);
      } catch (error) {
        log.error(`Error processing message ${message.id}:`, error);
        message.retry();
        log.log(`Message scheduled for retry: ${message.id}`);
      }
    }
  },
};
