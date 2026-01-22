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
} from './types';
import {
  isInDotFolder,
  githubFetch,
  getRepoApiUrl,
  getContentsApiUrl,
  generateId,
  generateSlug,
  decodeBase64,
} from './utils';

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
  env: IndexingEnv
): Promise<GitHubContent | null> {
  // Only accept SKILL.md in root directory (not in any dot folders like .claude/, .cursor/, etc.)
  // Skills in dot folders are IDE-specific configurations
  const paths = ['SKILL.md', 'skill.md'];

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
  env: IndexingEnv
): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT id FROM skills WHERE repo_owner = ? AND repo_name = ? LIMIT 1'
  )
    .bind(owner, name)
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
  env: IndexingEnv
): Promise<string> {
  const skillId = generateId();
  const slug = generateSlug(repo.owner.login, repo.name);
  const now = Date.now();

  let name = repo.name;
  let description = repo.description;

  if (skillMd.content) {
    const content = decodeBase64(skillMd.content);
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      name = titleMatch[1].trim();
    }
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
  repo: GitHubRepo,
  env: IndexingEnv
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

async function cacheSkillMd(
  skillId: string,
  owner: string,
  name: string,
  skillMd: GitHubContent,
  env: IndexingEnv
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

async function processMessage(
  message: IndexingMessage,
  env: IndexingEnv
): Promise<void> {
  const { repoOwner, repoName } = message;

  console.log(`Processing repo: ${repoOwner}/${repoName}`);

  const repo = await getRepoInfo(repoOwner, repoName, env);
  if (!repo) {
    console.log(`Repo not found: ${repoOwner}/${repoName}`);
    return;
  }

  if (repo.fork) {
    console.log(`Skipping fork: ${repoOwner}/${repoName}`);
    return;
  }

  const skillMd = await getSkillMd(repoOwner, repoName, env);
  if (!skillMd) {
    console.log(`No SKILL.md found: ${repoOwner}/${repoName}`);
    return;
  }

  const exists = await skillExists(repoOwner, repoName, env);

  let skillId: string;

  if (exists) {
    const updatedId = await updateSkill(repoOwner, repoName, repo, env);
    if (!updatedId) {
      console.error(`Failed to update skill: ${repoOwner}/${repoName}`);
      return;
    }
    skillId = updatedId;
    console.log(`Updated skill: ${skillId}`);
  } else {
    const authorId = await upsertAuthor(repo, env);
    skillId = await createSkill(repo, skillMd, authorId, env);
    console.log(`Created skill: ${skillId}`);
  }

  const r2Path = await cacheSkillMd(skillId, repoOwner, repoName, skillMd, env);

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
  async queue(
    batch: MessageBatch<IndexingMessage>,
    env: IndexingEnv,
    _ctx: ExecutionContext
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
