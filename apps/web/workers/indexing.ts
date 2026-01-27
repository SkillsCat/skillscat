/**
 * Indexing Worker
 *
 * 消费 indexing 队列，获取 GitHub 仓库信息并入库
 * - 检查仓库是否包含 SKILL.md
 * - 获取仓库元数据
 * - 存储到 D1 数据库
 * - 缓存 SKILL.md 到 R2
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
} from './shared/types';
import {
  isInDotFolder,
  githubFetch,
  getRepoApiUrl,
  getContentsApiUrl,
  generateId,
  generateSlug,
  checkSlugCollision,
  decodeBase64,
  createLogger,
} from './shared/utils';

const log = createLogger('Indexing');

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
function parseSkillFrontmatter(content: string): ParsedSkillMd {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];
  const frontmatter: SkillFrontmatter = {};

  // Parse name
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  if (nameMatch) frontmatter.name = nameMatch[1].trim();

  // Parse description
  const descMatch = yamlContent.match(/^description:\s*(.+)$/m);
  if (descMatch) frontmatter.description = descMatch[1].trim();

  // Parse category (single, root level)
  const categoryMatch = yamlContent.match(/^category:\s*(.+)$/m);
  if (categoryMatch) frontmatter.category = categoryMatch[1].trim();

  // Parse categories (multiple, root level)
  const categoriesMatch = yamlContent.match(/^categories:\s*(.+)$/m);
  if (categoriesMatch) frontmatter.categories = categoriesMatch[1].trim();

  // Parse keywords (alias for tags, root level)
  const keywordsMatch = yamlContent.match(/^keywords:\s*(.+)$/m);
  if (keywordsMatch) frontmatter.keywords = keywordsMatch[1].trim();

  // Parse metadata.tags
  const tagsMatch = yamlContent.match(/tags:\s*(.+)$/m);
  if (tagsMatch) {
    frontmatter.metadata = frontmatter.metadata || {};
    frontmatter.metadata.tags = tagsMatch[1].trim();
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

// ============================================
// Anti-abuse Functions
// ============================================

// Anti-abuse: Compute SHA-256 hash
async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Anti-abuse: Normalize content for comparison
function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

// Anti-abuse: Check for duplicate of high-star skill
async function checkForDuplicate(
  contentHash: string,
  env: IndexingEnv,
  minStars: number = 1000
): Promise<{ isDuplicate: boolean; originalSlug?: string }> {
  const match = await env.DB.prepare(`
    SELECT ch.skill_id, s.slug, s.stars
    FROM content_hashes ch
    INNER JOIN skills s ON ch.skill_id = s.id
    WHERE ch.hash_value = ?
      AND s.stars >= ?
      AND s.visibility = 'public'
    ORDER BY s.stars DESC
    LIMIT 1
  `)
    .bind(contentHash, minStars)
    .first<{ skill_id: string; slug: string; stars: number }>();

  if (match) {
    return { isDuplicate: true, originalSlug: match.slug };
  }
  return { isDuplicate: false };
}

// Anti-abuse: Store content hashes
async function storeContentHashes(
  skillId: string,
  fullHash: string,
  normalizedHash: string,
  env: IndexingEnv
): Promise<void> {
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO content_hashes (id, skill_id, hash_type, hash_value, created_at)
    VALUES (?, ?, 'full', ?, ?)
    ON CONFLICT(skill_id, hash_type) DO UPDATE SET hash_value = excluded.hash_value
  `)
    .bind(crypto.randomUUID(), skillId, fullHash, now)
    .run();

  await env.DB.prepare(`
    INSERT INTO content_hashes (id, skill_id, hash_type, hash_value, created_at)
    VALUES (?, ?, 'normalized', ?, ?)
    ON CONFLICT(skill_id, hash_type) DO UPDATE SET hash_value = excluded.hash_value
  `)
    .bind(crypto.randomUUID(), skillId, normalizedHash, now)
    .run();
}

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
  // Build paths based on skillPath
  // Only accept SKILL.md in the specified path (not in any dot folders like .claude/, .cursor/, etc.)
  const basePath = skillPath ? `${skillPath}/` : '';
  const paths = [`${basePath}SKILL.md`, `${basePath}skill.md`];

  for (const path of paths) {
    // Skip if path is in a dot folder
    if (isInDotFolder(path)) {
      continue;
    }

    const content = await githubFetch<GitHubContent>(
      getContentsApiUrl(owner, name, path),
      {
        token: env.GITHUB_TOKEN,
        apiVersion: env.GITHUB_API_VERSION,
        userAgent: 'SkillsCat-Indexing-Worker/1.0',
      }
    );
    if (content && content.type === 'file') {
      // Double-check the returned path is not in a dot folder
      if (content.path && isInDotFolder(content.path)) {
        continue;
      }
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
    'SELECT id FROM skills WHERE repo_owner = ? AND repo_name = ? AND (skill_path = ? OR (skill_path IS NULL AND ? = \'\')) LIMIT 1'
  )
    .bind(owner, name, normalizedPath, normalizedPath)
    .first();

  return result !== null;
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
  skillMd: GitHubContent,
  authorId: string,
  env: IndexingEnv,
  skillPath?: string,
  frontmatter?: SkillFrontmatter | null
): Promise<string> {
  const skillId = generateId();
  const now = Date.now();

  // Use frontmatter name/description if available, fallback to repo data
  let name = frontmatter?.name || repo.name;
  let description = frontmatter?.description || repo.description;

  // Fallback: extract from markdown content if no frontmatter
  if (!frontmatter?.name && skillMd.content) {
    const content = decodeBase64(skillMd.content);
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      name = titleMatch[1].trim();
    }
    if (!frontmatter?.description) {
      const descMatch = content.match(/^#.+\n+(.+?)(?:\n\n|\n#|$)/s);
      if (descMatch) {
        description = descMatch[1].trim().slice(0, 500);
      }
    }
  }

  // Generate slug with collision handling
  let slug: string;
  const normalizedPath = skillPath || '';

  if (normalizedPath && frontmatter?.name) {
    // Try displayName-based slug first for subfolder skills
    const displayNameSlug = generateSlug(repo.owner.login, repo.name, normalizedPath, frontmatter.name);
    const hasCollision = await checkSlugCollision(env.DB, displayNameSlug);
    if (hasCollision) {
      // Fallback to path-based slug
      slug = generateSlug(repo.owner.login, repo.name, normalizedPath);
    } else {
      slug = displayNameSlug;
    }
  } else {
    // Root skill or no displayName
    slug = generateSlug(repo.owner.login, repo.name, normalizedPath || undefined);
  }

  await env.DB.prepare(`
    INSERT INTO skills (
      id, name, slug, description, repo_owner, repo_name, skill_path, repo_url,
      skill_md_url, stars, forks, language, license, topics,
      author_id, trending_score, created_at, updated_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      skillId,
      name,
      slug,
      description,
      repo.owner.login,
      repo.name,
      normalizedPath,
      repo.html_url,
      skillMd.html_url,
      repo.stargazers_count,
      repo.forks_count,
      repo.language,
      repo.license?.spdx_id || null,
      JSON.stringify(repo.topics || []),
      authorId,
      0,
      now,
      now,
      now
    )
    .run();

  return skillId;
}

async function updateSkill(
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
      language = ?,
      license = ?,
      topics = ?,
      updated_at = ?,
      indexed_at = ?
    WHERE repo_owner = ? AND repo_name = ? AND (skill_path = ? OR (skill_path IS NULL AND ? = ''))
    RETURNING id
  `)
    .bind(
      repo.stargazers_count,
      repo.forks_count,
      repo.language,
      repo.license?.spdx_id || null,
      JSON.stringify(repo.topics || []),
      now,
      now,
      owner,
      name,
      normalizedPath,
      normalizedPath
    )
    .first<{ id: string }>();

  return result?.id || null;
}

async function cacheSkillMd(
  skillId: string,
  owner: string,
  name: string,
  skillMd: GitHubContent,
  env: IndexingEnv,
  skillPath?: string
): Promise<string> {
  // Include skill path in R2 path for multi-skill repos
  const pathPart = skillPath ? `/${skillPath}` : '';
  const r2Path = `skills/${owner}/${name}${pathPart}/SKILL.md`;

  let content = '';
  if (skillMd.content) {
    content = decodeBase64(skillMd.content);
  } else if (skillMd.download_url) {
    const response = await fetch(skillMd.download_url);
    content = await response.text();
  }

  await env.R2.put(r2Path, content, {
    httpMetadata: {
      contentType: 'text/markdown',
    },
    customMetadata: {
      skillId,
      sha: skillMd.sha,
      indexedAt: new Date().toISOString(),
      skillPath: skillPath || '',
    },
  });

  return r2Path;
}

/**
 * Save skill tags from frontmatter to the database
 */
async function saveSkillTags(
  skillId: string,
  tagsString: string,
  env: IndexingEnv
): Promise<string[]> {
  const tags = tagsString
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

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

async function processMessage(
  message: IndexingMessage,
  env: IndexingEnv
): Promise<void> {
  const { repoOwner, repoName, skillPath } = message;
  const source = message.submittedBy ? 'user-submit' : 'github-events';

  log.log(`Processing repo: ${repoOwner}/${repoName} (source: ${source}, skillPath: ${skillPath || 'root'})`, JSON.stringify(message));

  const repo = await getRepoInfo(repoOwner, repoName, env);
  if (!repo) {
    log.log(`Repo not found: ${repoOwner}/${repoName}`);
    return;
  }

  if (repo.fork) {
    log.log(`Skipping fork: ${repoOwner}/${repoName}`);
    return;
  }

  log.log(`Repo info fetched: ${repoOwner}/${repoName}, stars: ${repo.stargazers_count}, fork: ${repo.fork}`);

  // Use skillPath when fetching SKILL.md
  const skillMd = await getSkillMd(repoOwner, repoName, env, skillPath);
  if (!skillMd) {
    log.log(`No SKILL.md found: ${repoOwner}/${repoName}${skillPath ? `/${skillPath}` : ''}`);
    return;
  }

  log.log(`SKILL.md found: ${repoOwner}/${repoName}, path: ${skillMd.path}`);

  // Get SKILL.md content for anti-abuse check and frontmatter parsing
  let skillMdContent = '';
  if (skillMd.content) {
    skillMdContent = decodeBase64(skillMd.content);
  } else if (skillMd.download_url) {
    const response = await fetch(skillMd.download_url);
    skillMdContent = await response.text();
  }

  log.log(`SKILL.md content length: ${skillMdContent.length} chars`);

  // Parse YAML frontmatter
  const { frontmatter } = parseSkillFrontmatter(skillMdContent);
  if (frontmatter) {
    log.log(`Frontmatter parsed: name=${frontmatter.name}, description=${frontmatter.description?.slice(0, 50)}..., tags=${frontmatter.metadata?.tags}`);
  }

  // Compute content hashes
  const fullHash = await computeHash(skillMdContent);
  const normalizedHash = await computeHash(normalizeContent(skillMdContent));

  // Check existence with skillPath
  const exists = await skillExists(repoOwner, repoName, skillPath || null, env);
  log.log(`Skill exists in DB: ${exists}`);

  // Anti-abuse check for new skills with low stars
  if (!exists && repo.stargazers_count < 100) {
    const duplicate = await checkForDuplicate(normalizedHash, env, 1000);
    if (duplicate.isDuplicate) {
      log.log(`Rejecting duplicate of ${duplicate.originalSlug}: ${repoOwner}/${repoName}`);
      return;
    }
  }

  let skillId: string;

  if (exists) {
    const updatedId = await updateSkill(repoOwner, repoName, skillPath || null, repo, env);
    if (!updatedId) {
      log.error(`Failed to update skill: ${repoOwner}/${repoName}`);
      return;
    }
    skillId = updatedId;
    log.log(`Updated skill: ${skillId}`);
  } else {
    const authorId = await upsertAuthor(repo, env);
    log.log(`Author upserted: ${authorId}`);
    skillId = await createSkill(repo, skillMd, authorId, env, skillPath, frontmatter);
    log.log(`Created skill: ${skillId}`);
  }

  // Store content hashes for future duplicate detection
  await storeContentHashes(skillId, fullHash, normalizedHash, env);
  log.log(`Content hashes stored for: ${skillId}`);

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

  // Cache SKILL.md to R2 (include skillPath in R2 path)
  let r2Path: string;
  try {
    r2Path = await cacheSkillMd(skillId, repoOwner, repoName, skillMd, env, skillPath);
    log.log(`Cached SKILL.md to R2: ${r2Path}`);
  } catch (r2Error) {
    log.error(`Failed to cache SKILL.md to R2: ${repoOwner}/${repoName}`, r2Error);
    throw r2Error;
  }

  // Send to classification queue with tags and frontmatter categories
  const classificationMessage: ClassificationMessage & { tags?: string[] } = {
    type: 'classify',
    skillId,
    repoOwner,
    repoName,
    skillMdPath: r2Path,
  };

  // Include frontmatter categories for direct classification (cost optimization)
  if (frontmatterCategories.length > 0) {
    classificationMessage.frontmatterCategories = frontmatterCategories;
  }

  // Include tags if available (for classification hints)
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
}

export default {
  async queue(
    batch: MessageBatch<IndexingMessage>,
    env: IndexingEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    log.log(`Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
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

  async fetch(
    request: Request,
    _env: IndexingEnv,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
