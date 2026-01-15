/**
 * GitHub Events Worker
 *
 * 轮询 GitHub Events API，发现新的 SKILL.md 文件
 * 通过 Cron Trigger 每 5 分钟执行一次
 */

import type { GitHubEvent, IndexingMessage, Env } from './types';

const GITHUB_API_BASE = 'https://api.github.com';
const SKILL_FILE_PATTERN = /SKILL\.md$/i;
const EVENTS_PER_PAGE = 100;

/**
 * 获取 GitHub Events
 */
async function fetchGitHubEvents(
  env: Env,
  page: number = 1
): Promise<GitHubEvent[]> {
  const url = `${GITHUB_API_BASE}/events?per_page=${EVENTS_PER_PAGE}&page=${page}`;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat-Worker/1.0',
  };

  // 如果有 GitHub Token，添加认证
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * 检查事件是否包含 SKILL.md 文件
 */
function hasSkillFile(event: GitHubEvent): boolean {
  if (event.type !== 'PushEvent' || !event.payload.commits) {
    return false;
  }

  return event.payload.commits.some((commit) => {
    // 检查 commit message 是否提到 SKILL.md
    if (SKILL_FILE_PATTERN.test(commit.message)) {
      return true;
    }
    // 注意：GitHub Events API 不包含文件列表
    // 我们需要在 indexing worker 中进一步验证
    return false;
  });
}

/**
 * 从事件中提取仓库信息
 */
function extractRepoInfo(event: GitHubEvent): IndexingMessage | null {
  if (!event.repo) return null;

  const [owner, name] = event.repo.name.split('/');
  if (!owner || !name) return null;

  return {
    type: 'check_skill',
    repoOwner: owner,
    repoName: name,
    eventId: event.id,
    eventType: event.type,
    createdAt: event.created_at,
  };
}

/**
 * 获取上次处理的事件 ID
 */
async function getLastProcessedEventId(env: Env): Promise<string | null> {
  return env.KV.get('github-events:last-event-id');
}

/**
 * 保存最后处理的事件 ID
 */
async function setLastProcessedEventId(env: Env, eventId: string): Promise<void> {
  await env.KV.put('github-events:last-event-id', eventId, {
    expirationTtl: 86400 * 7, // 7 天过期
  });
}

/**
 * 检查事件是否已处理
 */
async function isEventProcessed(env: Env, eventId: string): Promise<boolean> {
  const key = `github-events:processed:${eventId}`;
  const value = await env.KV.get(key);
  return value !== null;
}

/**
 * 标记事件为已处理
 */
async function markEventProcessed(env: Env, eventId: string): Promise<void> {
  const key = `github-events:processed:${eventId}`;
  await env.KV.put(key, '1', {
    expirationTtl: 86400 * 7, // 7 天过期
  });
}

/**
 * 处理 GitHub Events
 */
async function processEvents(env: Env): Promise<{ processed: number; queued: number }> {
  let processed = 0;
  let queued = 0;

  try {
    const events = await fetchGitHubEvents(env);
    const lastEventId = await getLastProcessedEventId(env);

    // 按时间排序，最新的在前
    const sortedEvents = events.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // 记录最新的事件 ID
    if (sortedEvents.length > 0) {
      await setLastProcessedEventId(env, sortedEvents[0].id);
    }

    // 处理每个事件
    for (const event of sortedEvents) {
      // 如果遇到已处理的事件，停止处理
      if (event.id === lastEventId) {
        break;
      }

      // 检查是否已处理
      if (await isEventProcessed(env, event.id)) {
        continue;
      }

      processed++;

      // 只处理 PushEvent
      if (event.type !== 'PushEvent') {
        await markEventProcessed(env, event.id);
        continue;
      }

      // 提取仓库信息并发送到队列
      const message = extractRepoInfo(event);
      if (message) {
        await env.INDEXING_QUEUE.send(message);
        queued++;
        console.log(`Queued repo for indexing: ${message.repoOwner}/${message.repoName}`);
      }

      await markEventProcessed(env, event.id);
    }
  } catch (error) {
    console.error('Error processing GitHub events:', error);
    throw error;
  }

  return { processed, queued };
}

export default {
  /**
   * Cron Trigger Handler
   * 每 5 分钟执行一次
   */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log('GitHub Events Worker triggered at:', new Date().toISOString());

    const result = await processEvents(env);

    console.log(
      `Processed ${result.processed} events, queued ${result.queued} repos for indexing`
    );
  },

  /**
   * HTTP Handler (用于手动触发和健康检查)
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 手动触发 (需要认证)
    if (url.pathname === '/trigger') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.WORKER_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }

      const result = await processEvents(env);

      return new Response(
        JSON.stringify({
          success: true,
          processed: result.processed,
          queued: result.queued,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};
