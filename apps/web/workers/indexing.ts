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
  checkSlugCollision,
  createLogger,
  isTextFile,
  decodeBase64ToUtf8,
  buildFileTree,
} from './shared/utils';
import { githubRequest } from '../src/lib/server/github-client/request';
import { invalidateCache } from '../src/lib/server/cache';
import { PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS } from '../src/lib/server/cache/keys';
import { markRecommendDirty } from '../src/lib/server/ranking/recommend-precompute';
import { deleteSkillArtifactsAndInvalidateCaches } from '../src/lib/server/skill/delete';
import {
  chooseCanonicalSkillCandidate,
  computeBundleManifestHash,
  computeSkillMdHashes,
  convertPrivateSkillToPublicGithub,
  findSkillsByHashGroup,
  findPublicGithubCanonicalCandidates,
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
  loadIndexNowSkillTarget,
  scheduleIndexNowSubmission,
} from '../src/lib/server/seo/indexnow';
import {
  buildGithubSkillR2Key,
  buildGithubSkillR2Keys,
  buildGithubSkillR2Prefix,
} from '../src/lib/skill-path';

const log = createLogger('Indexing');

// ============================================
// Configuration Constants
// ============================================

const MAX_FILES = 50;              // 最大文件数
const MAX_FILE_SIZE = 512 * 1024;  // 单文件最大 512KB
const MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 总大小最大 5MB
const MAX_DISCOVERED_SKILLS_PER_REPO = 100;
const INDEXING_PROCESSED_TTL_SECONDS = 30 * 24 * 60 * 60;

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
  const categoryMatch = yamlContent.match(/^category:\s*(.+)$/m);
  if (categoryMatch) frontmatter.category = categoryMatch[1].trim();

  // Parse categories (multiple, root level)
  const categoriesMatch = yamlContent.match(/^categories:\s*(.+)$/m);
  if (categoriesMatch) frontmatter.categories = categoriesMatch[1].trim();

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
  const metaCategoryMatch = yamlContent.match(/metadata:[\s\S]*?category:\s*(.+)$/m);
  if (metaCategoryMatch && !frontmatter.category) {
    frontmatter.metadata = frontmatter.metadata || {};
    frontmatter.metadata.category = metaCategoryMatch[1].trim();
  }

  // Parse metadata.categories (nested)
  const metaCategoriesMatch = yamlContent.match(/metadata:[\s\S]*?categories:\s*(.+)$/m);
  if (metaCategoriesMatch && !frontmatter.categories) {
    frontmatter.metadata = frontmatter.metadata || {};
    frontmatter.metadata.categories = metaCategoriesMatch[1].trim();
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
  normalizedHash: string,
  bundleManifestHash: string,
  repo: GitHubRepo,
  skillMetadata: ResolvedSkillMetadata,
  persistenceMetadata: SkillPersistenceMetadata,
  skillPath: string | null,
  env: IndexingEnv
): Promise<{ converted: boolean; skillId?: string; slug?: string }> {
  const [existingPrivate] = await findSkillsByHashGroup(env.DB, normalizedHash, bundleManifestHash, {
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
    lastCommitAt: persistenceMetadata.lastCommitAt,
    skillMdFirstCommitAt: persistenceMetadata.skillMdFirstCommitAt,
    repoCreatedAt: persistenceMetadata.repoCreatedAt,
    indexedAt: now,
    updatedAt: now,
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
    token: env.GITHUB_TOKEN,
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
 * Get the newest and oldest commit dates for SKILL.md in the repository.
 */
async function getSkillCommitDates(
  owner: string,
  name: string,
  skillMdPath: string,
  env: IndexingEnv
): Promise<{ lastCommitAt: number | null; firstCommitAt: number | null }> {
  const commitsUrl = `https://api.github.com/repos/${owner}/${name}/commits?per_page=1&path=${encodeURIComponent(skillMdPath)}`;
  const newestResponse = await githubRequest(commitsUrl, {
    token: env.GITHUB_TOKEN,
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

  const newestCommits = await newestResponse.json() as Array<{
    sha: string;
    commit: {
      committer: {
        date: string;
      };
    };
  }>;

  if (!newestCommits || newestCommits.length === 0) {
    log.log(`No commits found for path: ${skillMdPath}`);
    return { lastCommitAt: null, firstCommitAt: null };
  }

  const lastCommitAt = new Date(newestCommits[0].commit.committer.date).getTime();
  let firstCommitAt = lastCommitAt;

  const lastPageUrl = extractLastLinkUrl(newestResponse.headers.get('link'));
  if (lastPageUrl) {
    const oldestResponse = await githubRequest(lastPageUrl, {
      token: env.GITHUB_TOKEN,
      apiVersion: env.GITHUB_API_VERSION,
      userAgent: 'SkillsCat-Indexing-Worker/1.0',
    });

    if (oldestResponse.ok) {
      const oldestCommits = await oldestResponse.json() as Array<{
        sha: string;
        commit: {
          committer: {
            date: string;
          };
        };
      }>;

      if (oldestCommits.length > 0) {
        firstCommitAt = new Date(oldestCommits[oldestCommits.length - 1].commit.committer.date).getTime();
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

async function scanRepositorySkillPaths(
  owner: string,
  name: string,
  branch: string,
  env: IndexingEnv
): Promise<string[]> {
  const treeUrl = `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`;
  const treeData = await githubFetch<GitHubTreeResponse>(treeUrl, {
    token: env.GITHUB_TOKEN,
    apiVersion: env.GITHUB_API_VERSION,
    userAgent: 'SkillsCat-Indexing-Worker/1.0',
  });

  if (!treeData) {
    throw new Error('Failed to fetch repository tree for skill path scan');
  }

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

/**
 * Get stored commit SHA from database
 */
async function getStoredCommitSha(
  owner: string,
  name: string,
  skillPath: string | null,
  env: IndexingEnv
): Promise<string | null> {
  const normalizedPath = skillPath || '';

  const result = await env.DB.prepare(`
    SELECT commit_sha FROM skills
    WHERE repo_owner = ? AND repo_name = ? AND COALESCE(skill_path, '') = ?
    LIMIT 1
  `)
    .bind(owner, name, normalizedPath)
    .first<{ commit_sha: string | null }>();

  return result?.commit_sha || null;
}

/**
 * Get stored blob SHAs from previous indexed file structure.
 */
async function getStoredFileShas(
  owner: string,
  name: string,
  skillPath: string | null,
  env: IndexingEnv
): Promise<Map<string, string>> {
  const normalizedPath = skillPath || '';
  const shas = new Map<string, string>();

  const result = await env.DB.prepare(`
    SELECT file_structure FROM skills
    WHERE repo_owner = ? AND repo_name = ? AND COALESCE(skill_path, '') = ?
    LIMIT 1
  `)
    .bind(owner, name, normalizedPath)
    .first<{ file_structure: string | null }>();

  if (!result?.file_structure) {
    return shas;
  }

  try {
    const parsed = JSON.parse(result.file_structure) as { files?: Array<{ path?: string; sha?: string }> };
    for (const file of parsed.files || []) {
      if (file.path && file.sha) {
        shas.set(file.path, file.sha);
      }
    }
  } catch (err) {
    log.warn(`Failed to parse stored file_structure for ${owner}/${name}:`, err);
  }

  return shas;
}

/**
 * Check if skill needs update based on commit SHA
 */
async function needsUpdate(
  owner: string,
  name: string,
  skillPath: string | null,
  latestCommitSha: string,
  forceReindex: boolean,
  env: IndexingEnv
): Promise<boolean> {
  if (forceReindex) {
    log.log(`Force reindex requested for ${owner}/${name}`);
    return true;
  }

  const storedSha = await getStoredCommitSha(owner, name, skillPath, env);

  if (!storedSha) {
    log.log(`No stored commit SHA for ${owner}/${name}, needs full index`);
    return true;
  }

  if (storedSha !== latestCommitSha) {
    log.log(`Commit SHA changed: ${storedSha} -> ${latestCommitSha}`);
    return true;
  }

  log.log(`Commit SHA unchanged: ${latestCommitSha}, skipping content fetch`);
  return false;
}

/**
 * Fetch all files from skill directory using GitHub Tree API
 */
async function fetchDirectoryFiles(
  owner: string,
  name: string,
  branch: string,
  skillPath: string | null,
  env: IndexingEnv,
  previousFileShas?: Map<string, string>
): Promise<{ files: DirectoryFile[]; textContents: Map<string, string> }> {
  const treeUrl = `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`;
  const treeData = await githubFetch<GitHubTreeResponse>(treeUrl, {
    token: env.GITHUB_TOKEN,
    apiVersion: env.GITHUB_API_VERSION,
    userAgent: 'SkillsCat-Indexing-Worker/1.0',
  });

  if (!treeData) {
    throw new Error('Failed to fetch repository tree');
  }

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
        token: env.GITHUB_TOKEN,
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

/**
 * Update skill metadata with commit SHA, file structure, and last commit date
 */
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

// ============================================
// Repository & Skill Functions
// ============================================

async function getRepoInfo(
  owner: string,
  name: string,
  env: IndexingEnv
): Promise<GitHubRepo | null> {
  return githubFetch<GitHubRepo>(getRepoApiUrl(owner, name), {
    token: env.GITHUB_TOKEN,
    apiVersion: env.GITHUB_API_VERSION,
    userAgent: 'SkillsCat-Indexing-Worker/1.0',
  });
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
        token: env.GITHUB_TOKEN,
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

async function skillExists(
  owner: string,
  name: string,
  skillPath: string | null,
  env: IndexingEnv
): Promise<boolean> {
  // Normalize skillPath: null and empty string are treated the same
  const normalizedPath = skillPath || '';

  const result = await env.DB.prepare(
    'SELECT id FROM skills WHERE repo_owner = ? AND repo_name = ? AND COALESCE(skill_path, \'\') = ? LIMIT 1'
  )
    .bind(owner, name, normalizedPath)
    .first();

  return result !== null;
}

interface SkillPersistenceMetadata {
  contentHash: string;
  lastCommitAt: number | null;
  skillMdFirstCommitAt: number | null;
  repoCreatedAt: number | null;
}

interface SkillIdentityRecord {
  id: string;
  slug: string;
  sourceType: string;
  visibility: string;
  repoOwner: string | null;
  repoName: string | null;
  skillPath: string | null;
  stars: number;
  lastCommitAt: number | null;
  skillMdFirstCommitAt: number | null;
  repoCreatedAt: number | null;
  createdAt: number;
  indexedAt: number | null;
}

async function getSkillIdentityRecord(
  skillId: string,
  env: IndexingEnv
): Promise<SkillIdentityRecord | null> {
  return env.DB.prepare(`
    SELECT
      id,
      slug,
      source_type as sourceType,
      visibility,
      repo_owner as repoOwner,
      repo_name as repoName,
      skill_path as skillPath,
      stars,
      last_commit_at as lastCommitAt,
      skill_md_first_commit_at as skillMdFirstCommitAt,
      repo_created_at as repoCreatedAt,
      created_at as createdAt,
      indexed_at as indexedAt
    FROM skills
    WHERE id = ?
    LIMIT 1
  `)
    .bind(skillId)
    .first<SkillIdentityRecord>();
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
  skillPath?: string,
  frontmatter?: SkillFrontmatter | null
): Promise<string> {
  const skillId = generateId();
  const now = Date.now();
  const { name, description } = skillMetadata;

  // Generate slug with collision handling
  const normalizedPath = skillPath || '';
  const baseSlug = generateSlug(repo.owner.login, repo.name, normalizedPath || undefined);
  const slugCandidates: string[] = [];

  if (normalizedPath && frontmatter?.name) {
    slugCandidates.push(generateSlug(repo.owner.login, repo.name, normalizedPath, frontmatter.name));
  }
  slugCandidates.push(baseSlug);

  // Deterministic suffix avoids infinite retries if sanitized slugs collide across repos.
  const repoSuffix = repo.id.toString(36);
  slugCandidates.push(`${baseSlug}-${repoSuffix}`);
  for (let i = 2; i <= 10; i++) {
    slugCandidates.push(`${baseSlug}-${repoSuffix}-${i}`);
  }

  const seen = new Set<string>();

  for (const candidateSlug of slugCandidates) {
    if (seen.has(candidateSlug)) continue;
    seen.add(candidateSlug);

    // Fast pre-check to avoid obvious unique conflicts.
    if (await checkSlugCollision(env.DB, candidateSlug)) {
      continue;
    }

    try {
      await env.DB.prepare(`
        INSERT INTO skills (
          id, name, slug, description, repo_owner, repo_name, skill_path, github_url,
          stars, forks, trending_score, content_hash, last_commit_at,
          skill_md_first_commit_at, repo_created_at, created_at, updated_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          persistenceMetadata.lastCommitAt,
          persistenceMetadata.skillMdFirstCommitAt,
          persistenceMetadata.repoCreatedAt,
          now,
          now,
          now
        )
        .run();

      return skillId;
    } catch (error) {
      const message = String(error);

      // Another worker could have inserted the same repo/path first.
      if (message.includes('skills_repo_path_unique') || (message.includes('repo_owner') && message.includes('repo_name'))) {
        const existing = await env.DB.prepare(`
          SELECT id FROM skills
          WHERE repo_owner = ? AND repo_name = ? AND COALESCE(skill_path, '') = ?
          LIMIT 1
        `)
          .bind(repo.owner.login, repo.name, normalizedPath)
          .first<{ id: string }>();

        if (existing?.id) {
          return existing.id;
        }
      }

      // Slug conflict could still happen under concurrent inserts, try next candidate.
      if (message.includes('skills_slug_unique') || message.includes('skills.slug')) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Unable to create unique slug for ${repo.owner.login}/${repo.name}${normalizedPath ? `/${normalizedPath}` : ''}`);
}

async function updateSkill(
  owner: string,
  name: string,
  skillPath: string | null,
  repo: GitHubRepo,
  skillMetadata: ResolvedSkillMetadata,
  persistenceMetadata: SkillPersistenceMetadata,
  env: IndexingEnv
): Promise<string | null> {
  const now = Date.now();
  const normalizedPath = skillPath || '';

  const result = await env.DB.prepare(`
    UPDATE skills SET
      name = ?,
      description = ?,
      stars = ?,
      forks = ?,
      content_hash = ?,
      last_commit_at = ?,
      skill_md_first_commit_at = ?,
      repo_created_at = ?,
      indexed_at = ?
    WHERE repo_owner = ? AND repo_name = ? AND COALESCE(skill_path, '') = ?
    RETURNING id
  `)
    .bind(
      skillMetadata.name,
      skillMetadata.description,
      repo.stargazers_count,
      repo.forks_count,
      persistenceMetadata.contentHash,
      persistenceMetadata.lastCommitAt,
      persistenceMetadata.skillMdFirstCommitAt,
      persistenceMetadata.repoCreatedAt,
      now,
      owner,
      name,
      normalizedPath,
    )
    .first<{ id: string }>();

  return result?.id || null;
}

async function updateSkillMetricsOnly(
  owner: string,
  name: string,
  skillPath: string | null,
  repo: GitHubRepo,
  env: IndexingEnv
): Promise<string | null> {
  const now = Date.now();
  const normalizedPath = skillPath || '';

  const result = await env.DB.prepare(`
    UPDATE skills SET
      stars = ?,
      forks = ?,
      indexed_at = ?
    WHERE repo_owner = ? AND repo_name = ? AND COALESCE(skill_path, '') = ?
    RETURNING id
  `)
    .bind(
      repo.stargazers_count,
      repo.forks_count,
      now,
      owner,
      name,
      normalizedPath,
    )
    .first<{ id: string }>();

  return result?.id || null;
}

function mapSkillRecordToCanonicalCandidate(skill: SkillIdentityRecord): CanonicalSkillCandidate {
  return {
    id: skill.id,
    slug: skill.slug,
    repoOwner: skill.repoOwner,
    repoName: skill.repoName,
    skillPath: skill.skillPath,
    sourceType: skill.sourceType,
    visibility: skill.visibility,
    stars: skill.stars,
    lastCommitAt: skill.lastCommitAt,
    skillMdFirstCommitAt: skill.skillMdFirstCommitAt,
    repoCreatedAt: skill.repoCreatedAt,
    createdAt: skill.createdAt,
    indexedAt: skill.indexedAt,
  };
}

async function reconcileCanonicalDuplicateGroup(
  skillId: string,
  normalizedHash: string,
  bundleManifestHash: string,
  env: IndexingEnv
): Promise<{ kept: boolean; canonicalId: string | null; removedIds: string[] }> {
  const currentSkill = await getSkillIdentityRecord(skillId, env);
  if (!currentSkill) {
    return { kept: false, canonicalId: null, removedIds: [] };
  }

  const existingCandidates = await findPublicGithubCanonicalCandidates(
    env.DB,
    normalizedHash,
    bundleManifestHash,
    skillId
  );
  const allCandidates = [mapSkillRecordToCanonicalCandidate(currentSkill), ...existingCandidates];
  const canonical = chooseCanonicalSkillCandidate(allCandidates);

  if (!canonical) {
    return { kept: true, canonicalId: currentSkill.id, removedIds: [] };
  }

  const losers = allCandidates.filter((candidate) => candidate.id !== canonical.id);
  for (const loser of losers) {
    await deleteSkillArtifactsAndInvalidateCaches({
      db: env.DB,
      r2: env.R2,
      indexNow: {
        env,
      },
      skill: {
        id: loser.id,
        slug: loser.slug,
        sourceType: loser.sourceType,
        repoOwner: loser.repoOwner,
        repoName: loser.repoName,
        skillPath: loser.skillPath,
      },
    });
    log.log(`Deleted duplicate skill ${loser.slug} in favor of ${canonical.slug}`);
  }

  return {
    kept: canonical.id === currentSkill.id,
    canonicalId: canonical.id,
    removedIds: losers.map((candidate) => candidate.id),
  };
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
function extractFrontmatterCategories(frontmatter: SkillFrontmatter | null): string[] {
  if (!frontmatter) return [];

  const categories: string[] = [];

  // Check root level category (single)
  if (frontmatter.category) {
    categories.push(...frontmatter.category.split(',').map(c => c.trim().toLowerCase()));
  }

  // Check root level categories (multiple)
  if (frontmatter.categories) {
    categories.push(...frontmatter.categories.split(',').map(c => c.trim().toLowerCase()));
  }

  // Check metadata.category as fallback
  if (frontmatter.metadata?.category && categories.length === 0) {
    categories.push(...frontmatter.metadata.category.split(',').map(c => c.trim().toLowerCase()));
  }

  // Check metadata.categories as fallback
  if (frontmatter.metadata?.categories && categories.length === 0) {
    categories.push(...frontmatter.metadata.categories.split(',').map(c => c.trim().toLowerCase()));
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

function buildProcessedCandidateKey(
  owner: string,
  repo: string,
  skillPath: string | null | undefined,
  headSha: string
): string {
  return `indexing:processed:${owner.toLowerCase()}/${repo.toLowerCase()}:${(skillPath || '').toLowerCase()}:${headSha.toLowerCase()}`;
}

async function wasCandidateProcessed(env: IndexingEnv, key: string): Promise<boolean> {
  return (await env.KV.get(key)) !== null;
}

async function markCandidateProcessed(env: IndexingEnv, key: string): Promise<void> {
  await env.KV.put(key, '1', {
    expirationTtl: INDEXING_PROCESSED_TTL_SECONDS,
  });
}

async function queueDiscoveredSkillPaths(
  message: IndexingMessage,
  owner: string,
  repo: string,
  headSha: string,
  skillPaths: string[],
  env: IndexingEnv
): Promise<number> {
  let queued = 0;

  for (const discoveredSkillPath of skillPaths) {
    if (!discoveredSkillPath) continue;

    const processedKey = buildProcessedCandidateKey(owner, repo, discoveredSkillPath, headSha);
    if (!message.forceReindex && await wasCandidateProcessed(env, processedKey)) {
      continue;
    }

    await env.INDEXING_QUEUE.send({
      type: 'check_skill',
      repoOwner: owner,
      repoName: repo,
      skillPath: discoveredSkillPath,
      submittedBy: message.submittedBy,
      submittedAt: message.submittedAt,
      forceReindex: message.forceReindex,
      discoverySource: message.discoverySource,
      discoveryFingerprint: message.discoveryFingerprint,
    });
    queued++;
  }

  return queued;
}

async function processMessage(
  message: IndexingMessage,
  env: IndexingEnv
): Promise<void> {
  const { repoOwner, repoName, skillPath, forceReindex } = message;
  const source = message.submittedBy ? 'user-submit' : (message.discoverySource || 'github-events');

  log.log(`Processing repo: ${repoOwner}/${repoName} (source: ${source}, skillPath: ${skillPath || 'root'})`, JSON.stringify(message));

  // Step 1: Get repository info
  const repo = await getRepoInfo(repoOwner, repoName, env);
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
  const latestCommit = await getLatestCommitSha(
    canonicalRepoOwner,
    canonicalRepoName,
    env,
    repo.default_branch
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
  if (!forceReindex && await wasCandidateProcessed(env, processedCandidateKey)) {
    log.log(`Skipping exact candidate already processed: ${processedCandidateKey}`);
    return;
  }

  let shouldMarkProcessed = false;
  let discoveredRepositorySkillPaths: string[] | null = null;

  try {
    if (!skillPath) {
      try {
        discoveredRepositorySkillPaths = await scanRepositorySkillPaths(
          canonicalRepoOwner,
          canonicalRepoName,
          latestCommit.branch,
          env
        );
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

    // Step 3: Check if update is needed
    const exists = await skillExists(canonicalRepoOwner, canonicalRepoName, skillPath || null, env);
    const shouldFetchContent = await needsUpdate(
      canonicalRepoOwner,
      canonicalRepoName,
      skillPath || null,
      latestCommit.sha,
      forceReindex || false,
      env
    );

    // If skill exists and no content update needed, just update stars/forks
    if (exists && !shouldFetchContent) {
      const updatedId = await updateSkillMetricsOnly(
        canonicalRepoOwner,
        canonicalRepoName,
        skillPath || null,
        repo,
        env
      );
      if (updatedId) {
        await syncRepoMetricsForGithubSkills(
          env.DB,
          canonicalRepoOwner,
          canonicalRepoName,
          repo.stargazers_count,
          repo.forks_count
        );
        log.log(`Updated stars/forks only for skill: ${updatedId}`);
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
        env
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
    const previousFileShas = exists
      ? await getStoredFileShas(canonicalRepoOwner, canonicalRepoName, skillPath || null, env)
      : undefined;

    try {
      const result = await fetchDirectoryFiles(
        canonicalRepoOwner,
        canonicalRepoName,
        latestCommit.branch,
        skillPath || null,
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
          token: env.GITHUB_TOKEN,
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
    const bundleManifestHash = await computeBundleManifestHash(directoryFiles, normalizedHash);
    const { lastCommitAt, firstCommitAt } = await getSkillCommitDates(
      canonicalRepoOwner,
      canonicalRepoName,
      skillMd.path,
      env
    );
    const persistenceMetadata: SkillPersistenceMetadata = {
      contentHash: fullHash,
      lastCommitAt,
      skillMdFirstCommitAt: firstCommitAt,
      repoCreatedAt: repo.created_at ? new Date(repo.created_at).getTime() : null,
    };

    // Step 7: Create or update skill record.
    let skillId: string;
    let shouldRunCanonicalDedup = true;

    if (exists) {
      const updatedId = await updateSkill(
        canonicalRepoOwner,
        canonicalRepoName,
        skillPath || null,
        repo,
        skillMetadata,
        persistenceMetadata,
        env
      );
      if (!updatedId) {
        log.error(`Failed to update skill: ${canonicalRepoOwner}/${canonicalRepoName}`);
        return;
      }
      skillId = updatedId;
      log.log(`Updated skill: ${skillId}`);
    } else {
      const curationResult = await checkAndConvertPrivateSkill(
        normalizedHash,
        bundleManifestHash,
        repo,
        skillMetadata,
        persistenceMetadata,
        skillPath || null,
        env
      );
      if (curationResult.converted && curationResult.skillId) {
        skillId = curationResult.skillId;
        shouldRunCanonicalDedup = false;
        log.log(`Curation: Converted private skill to public: ${curationResult.slug} (${skillId})`);
        await invalidatePublicDiscoveryCaches(`curation publish ${curationResult.slug || skillId}`);
      } else {
        const authorId = await upsertAuthor(repo, env);
        log.log(`Author upserted: ${authorId}`);
        skillId = await createSkill(repo, skillMetadata, env, persistenceMetadata, skillPath, frontmatter);
        log.log(`Created skill: ${skillId}`);
        await invalidatePublicDiscoveryCaches(`github publish ${canonicalRepoOwner}/${canonicalRepoName}${skillPath ? `/${skillPath}` : ''}`);
      }
    }

    await syncRepoMetricsForGithubSkills(
      env.DB,
      canonicalRepoOwner,
      canonicalRepoName,
      repo.stargazers_count,
      repo.forks_count
    );

    await storeSkillHashes(env.DB, skillId, {
      fullHash,
      normalizedHash,
      bundleManifestHash,
    });
    log.log(`Stored skill hashes for ${skillId}`);

    if (shouldRunCanonicalDedup) {
      const dedupResult = await reconcileCanonicalDuplicateGroup(
        skillId,
        normalizedHash,
        bundleManifestHash,
        env
      );
      if (!dedupResult.kept) {
        log.log(`Discarded duplicate candidate ${skillId}; canonical skill is ${dedupResult.canonicalId}`);
        shouldMarkProcessed = true;
        return;
      }
    }

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

    // Step 9: Update commit_sha, file_structure, and last_commit_at
    const fileStructure: FileStructure = {
      commitSha: latestCommit.sha,
      indexedAt: new Date().toISOString(),
      files: directoryFiles,
      fileTree: buildFileTree(directoryFiles),
    };
    const securityContentFingerprint = await buildSecurityContentFingerprint(directoryFiles);

    await updateSkillMetadata(skillId, latestCommit.sha, fileStructure, lastCommitAt, env);

    try {
      const indexNowTarget = await loadIndexNowSkillTarget(env.DB, skillId);
      if (indexNowTarget) {
        await scheduleIndexNowSubmission({
          env,
          urls: buildIndexNowSkillUrls(indexNowTarget),
          source: `indexing:${indexNowTarget.slug}`,
        });
      }
    } catch (indexNowError) {
      log.error(`Failed to enqueue IndexNow update for ${skillId}`, indexNowError);
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
    const seenInBatch = new Set<string>();

    for (const message of batch.messages) {
      const dedupKey = getMessageDedupKey(message.body);

      if (seenInBatch.has(dedupKey) && !message.body.forceReindex) {
        log.log(`Skipping duplicate message in batch: ${dedupKey}`);
        message.ack();
        continue;
      }
      seenInBatch.add(dedupKey);

      try {
        if (!message.body.forceReindex) {
          log.log(`Processing deduped queue candidate: ${dedupKey}`);
        }
        log.log(`Processing message ID: ${message.id}`);
        await processMessage(message.body, env);
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
