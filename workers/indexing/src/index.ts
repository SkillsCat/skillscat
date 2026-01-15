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
  Env,
  IndexingMessage,
  ClassificationMessage,
  GitHubRepo,
  GitHubContent,
} from './types';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 生成 slug
 */
function generateSlug(owner: string, name: string): string {
  return `${owner}-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * GitHub API 请求
 */
async function githubFetch<T>(
  url: string,
  env: Env
): Promise<T | null> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': env.GITHUB_API_VERSION || '2022-11-28',
    'User-Agent': 'SkillsCat-Indexing-Worker/1.0',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * 获取仓库信息
 */
async function getRepoInfo(
  owner: string,
  name: string,
  env: Env
): Promise<GitHubRepo | null> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${name}`;
  return githubFetch<GitHubRepo>(url, env);
}

/**
 * 获取 SKILL.md 内容
 */
async function getSkillMd(
  owner: string,
  name: string,
  env: Env
): Promise<GitHubContent | null> {
  // 尝试多个可能的路径
  const paths = ['SKILL.md', '.claude/SKILL.md', 'skill.md', '.claude/skill.md'];

  for (const path of paths) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${name}/contents/${path}`;
    const content = await githubFetch<GitHubContent>(url, env);
    if (content && content.type === 'file') {
      return content;
    }
  }

  return null;
}

/**
 * 解码 Base64 内容
 */
function decodeBase64(content: string): string {
  return atob(content.replace(/\n/g, ''));
}

/**
 * 检查 skill 是否已存在
 */
async function skillExists(
  owner: string,
  name: string,
  env: Env
): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT id FROM skills WHERE repo_owner = ? AND repo_name = ? LIMIT 1'
  )
    .bind(owner, name)
    .first();

  return result !== null;
}

/**
 * 创建或更新 author
 */
async function upsertAuthor(
  repo: GitHubRepo,
  env: Env
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

/**
 * 创建 skill 记录
 */
async function createSkill(
  repo: GitHubRepo,
  skillMd: GitHubContent,
  authorId: string,
  env: Env
): Promise<string> {
  const skillId = generateId();
  const slug = generateSlug(repo.owner.login, repo.name);
  const now = Date.now();

  // 从 SKILL.md 提取名称和描述
  let name = repo.name;
  let description = repo.description;

  if (skillMd.content) {
    const content = decodeBase64(skillMd.content);
    // 尝试从 SKILL.md 提取标题
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      name = titleMatch[1].trim();
    }
    // 尝试提取第一段作为描述
    const descMatch = content.match(/^#.+\n+(.+?)(?:\n\n|\n#|$)/s);
    if (descMatch) {
      description = descMatch[1].trim().slice(0, 500);
    }
  }

  await env.DB.prepare(`
    INSERT INTO skills (
      id, name, slug, description, repo_owner, repo_name, repo_url,
      skill_md_url, stars, forks, language, license, topics,
      author_id, trending_score, created_at, updated_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      skillId,
      name,
      slug,
      description,
      repo.owner.login,
      repo.name,
      repo.html_url,
      skillMd.html_url,
      repo.stargazers_count,
      repo.forks_count,
      repo.language,
      repo.license?.spdx_id || null,
      JSON.stringify(repo.topics || []),
      authorId,
      0, // initial trending score
      now,
      now,
      now
    )
    .run();

  return skillId;
}

/**
 * 更新 skill 记录
 */
async function updateSkill(
  owner: string,
  name: string,
  repo: GitHubRepo,
  env: Env
): Promise<string | null> {
  const now = Date.now();

  const result = await env.DB.prepare(`
    UPDATE skills SET
      stars = ?,
      forks = ?,
      language = ?,
      license = ?,
      topics = ?,
      updated_at = ?,
      indexed_at = ?
    WHERE repo_owner = ? AND repo_name = ?
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
      name
    )
    .first<{ id: string }>();

  return result?.id || null;
}

/**
 * 缓存 SKILL.md 到 R2
 */
async function cacheSkillMd(
  skillId: string,
  owner: string,
  name: string,
  skillMd: GitHubContent,
  env: Env
): Promise<string> {
  const r2Path = `skills/${owner}/${name}/SKILL.md`;

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
    },
  });

  return r2Path;
}

/**
 * 处理单个消息
 */
async function processMessage(
  message: IndexingMessage,
  env: Env
): Promise<void> {
  const { repoOwner, repoName } = message;

  console.log(`Processing repo: ${repoOwner}/${repoName}`);

  // 1. 获取仓库信息
  const repo = await getRepoInfo(repoOwner, repoName, env);
  if (!repo) {
    console.log(`Repo not found: ${repoOwner}/${repoName}`);
    return;
  }

  // 跳过 fork 仓库
  if (repo.fork) {
    console.log(`Skipping fork: ${repoOwner}/${repoName}`);
    return;
  }

  // 2. 检查 SKILL.md 是否存在
  const skillMd = await getSkillMd(repoOwner, repoName, env);
  if (!skillMd) {
    console.log(`No SKILL.md found: ${repoOwner}/${repoName}`);
    return;
  }

  // 3. 检查是否已存在
  const exists = await skillExists(repoOwner, repoName, env);

  let skillId: string;

  if (exists) {
    // 更新现有记录
    const updatedId = await updateSkill(repoOwner, repoName, repo, env);
    if (!updatedId) {
      console.error(`Failed to update skill: ${repoOwner}/${repoName}`);
      return;
    }
    skillId = updatedId;
    console.log(`Updated skill: ${skillId}`);
  } else {
    // 创建新记录
    const authorId = await upsertAuthor(repo, env);
    skillId = await createSkill(repo, skillMd, authorId, env);
    console.log(`Created skill: ${skillId}`);
  }

  // 4. 缓存 SKILL.md 到 R2
  const r2Path = await cacheSkillMd(skillId, repoOwner, repoName, skillMd, env);

  // 5. 发送到 classification 队列
  const classificationMessage: ClassificationMessage = {
    type: 'classify',
    skillId,
    repoOwner,
    repoName,
    skillMdPath: r2Path,
  };

  await env.CLASSIFICATION_QUEUE.send(classificationMessage);
  console.log(`Sent to classification queue: ${skillId}`);
}

export default {
  /**
   * Queue Consumer Handler
   */
  async queue(
    batch: MessageBatch<IndexingMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
        await processMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error(`Error processing message:`, error);
        message.retry();
      }
    }
  },

  /**
   * HTTP Handler (用于健康检查和手动触发)
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
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
