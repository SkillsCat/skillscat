/**
 * GitHub Events Worker
 *
 * 轮询 GitHub Events API，发现新的 SKILL.md 文件
 * 通过 Cron Trigger 每 5 分钟执行一次
 */

import type { GithubEventsEnv, GitHubEvent, IndexingMessage } from './shared/types';

const GITHUB_API_BASE = 'https://api.github.com';
const EVENTS_PER_PAGE = 100;

/**
 * 获取 GitHub Events
 */
async function fetchGitHubEvents(
  env: GithubEventsEnv,
  page: number = 1
): Promise<GitHubEvent[]> {
  const url = `${GITHUB_API_BASE}/events?per_page=${EVENTS_PER_PAGE}&page=${page}`;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat-Worker/1.0',
  };

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
async function getLastProcessedEventId(env: GithubEventsEnv): Promise<string | null> {
  return env.KV.get('github-events:last-event-id');
}

/**
 * 保存最后处理的事件 ID
 */
async function setLastProcessedEventId(env: GithubEventsEnv, eventId: string): Promise<void> {
  await env.KV.put('github-events:last-event-id', eventId, {
    expirationTtl: 86400 * 7,
  });
}

/**
 * 检查事件是否已处理
 */
async function isEventProcessed(env: GithubEventsEnv, eventId: string): Promise<boolean> {
  const key = `github-events:processed:${eventId}`;
  const value = await env.KV.get(key);
  return value !== null;
}

/**
 * 标记事件为已处理
 */
async function markEventProcessed(env: GithubEventsEnv, eventId: string): Promise<void> {
  const key = `github-events:processed:${eventId}`;
  await env.KV.put(key, '1', {
    expirationTtl: 86400 * 7,
  });
}

/**
 * 处理 GitHub Events
 */
async function processEvents(env: GithubEventsEnv): Promise<{ processed: number; queued: number }> {
  let processed = 0;
  let queued = 0;

  try {
    const events = await fetchGitHubEvents(env);
    const lastEventId = await getLastProcessedEventId(env);

    const sortedEvents = events.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    if (sortedEvents.length > 0) {
      await setLastProcessedEventId(env, sortedEvents[0].id);
    }

    for (const event of sortedEvents) {
      if (event.id === lastEventId) {
        break;
      }

      if (await isEventProcessed(env, event.id)) {
        continue;
      }

      processed++;

      if (event.type !== 'PushEvent') {
        await markEventProcessed(env, event.id);
        continue;
      }

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
  async scheduled(
    _controller: ScheduledController,
    env: GithubEventsEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('GitHub Events Worker triggered at:', new Date().toISOString());

    const result = await processEvents(env);

    console.log(
      `Processed ${result.processed} events, queued ${result.queued} repos for indexing`
    );
  },
};
