import {
  resolveNextUpdateAtAfterAccess,
  queueArchivedSkillResurrectionCheck,
} from '../src/lib/server/db/business/access';
import {
  buildSkillMetricDate,
  type SkillMetricMessage,
} from '../src/lib/server/skill/metrics';

interface MetricsEnv {
  DB: D1Database;
  KV: KVNamespace;
  WORKER_SECRET?: string;
  RESURRECTION_WORKER_URL?: string;
}

interface MetricSkillRow {
  id: string;
  visibility: string;
  tier: 'hot' | 'warm' | 'cool' | 'cold' | 'archived';
  next_update_at: number | null;
  last_accessed_at: number | null;
}

interface AggregatedSkillAccess {
  count: number;
  lastOccurredAt: number;
}

interface AggregatedDailyMetric {
  skillId: string;
  metricDate: string;
  accessCount: number;
  downloadCount: number;
  installCount: number;
  lastAccessedAt: number | null;
}

export function aggregateSkillMetricMessages(messages: SkillMetricMessage[]): {
  accessBySkill: Map<string, AggregatedSkillAccess>;
  dailyMetrics: AggregatedDailyMetric[];
} {
  const accessBySkill = new Map<string, AggregatedSkillAccess>();
  const dailyMetricsByKey = new Map<string, AggregatedDailyMetric>();
  const seenAccessDedupeKeys = new Set<string>();

  for (const message of messages) {
    if (!message || message.type !== 'skill_metric' || !message.skillId) {
      continue;
    }

    const occurredAt = Number.isFinite(message.occurredAt) && message.occurredAt > 0
      ? message.occurredAt
      : Date.now();

    if (message.metric === 'access') {
      const dedupeKey = message.dedupeKey || `${message.skillId}:${occurredAt}`;
      if (seenAccessDedupeKeys.has(dedupeKey)) {
        continue;
      }
      seenAccessDedupeKeys.add(dedupeKey);

      const current = accessBySkill.get(message.skillId) || { count: 0, lastOccurredAt: 0 };
      current.count += 1;
      current.lastOccurredAt = Math.max(current.lastOccurredAt, occurredAt);
      accessBySkill.set(message.skillId, current);
    }

    const metricDate = buildSkillMetricDate(occurredAt);
    const dailyKey = `${message.skillId}:${metricDate}`;
    const currentDaily = dailyMetricsByKey.get(dailyKey) || {
      skillId: message.skillId,
      metricDate,
      accessCount: 0,
      downloadCount: 0,
      installCount: 0,
      lastAccessedAt: null,
    };

    if (message.metric === 'access') {
      currentDaily.accessCount += 1;
      currentDaily.lastAccessedAt = Math.max(currentDaily.lastAccessedAt || 0, occurredAt);
    } else if (message.metric === 'download') {
      currentDaily.downloadCount += 1;
    } else if (message.metric === 'install') {
      currentDaily.installCount += 1;
    }

    dailyMetricsByKey.set(dailyKey, currentDaily);
  }

  return {
    accessBySkill,
    dailyMetrics: Array.from(dailyMetricsByKey.values()),
  };
}

export async function processQueuedSkillMetrics(
  messages: MessageBatch<SkillMetricMessage>,
  env: MetricsEnv
): Promise<void> {
  const parsed = aggregateSkillMetricMessages(messages.messages.map((message) => message.body));
  const skillIds = Array.from(new Set([
    ...parsed.accessBySkill.keys(),
    ...parsed.dailyMetrics.map((entry) => entry.skillId),
  ]));

  if (skillIds.length === 0) {
    return;
  }

  const placeholders = skillIds.map(() => '?').join(',');
  const skillRows = await env.DB.prepare(`
    SELECT id, visibility, tier, next_update_at, last_accessed_at
    FROM skills
    WHERE id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all<MetricSkillRow>();

  const skillMap = new Map((skillRows.results || []).map((row) => [row.id, row] as const));
  const statements: D1PreparedStatement[] = [];
  const sideEffects: Promise<unknown>[] = [];

  for (const entry of parsed.dailyMetrics) {
    const skill = skillMap.get(entry.skillId);
    if (!skill) {
      continue;
    }

    const accessCount = skill.visibility === 'public' ? entry.accessCount : 0;
    const lastAccessedAt = accessCount > 0 ? entry.lastAccessedAt : null;

    statements.push(
      env.DB.prepare(`
        INSERT INTO skill_daily_metrics (
          skill_id,
          metric_date,
          access_count,
          download_count,
          install_count,
          last_accessed_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(skill_id, metric_date) DO UPDATE SET
          access_count = skill_daily_metrics.access_count + excluded.access_count,
          download_count = skill_daily_metrics.download_count + excluded.download_count,
          install_count = skill_daily_metrics.install_count + excluded.install_count,
          last_accessed_at = CASE
            WHEN excluded.last_accessed_at IS NULL THEN skill_daily_metrics.last_accessed_at
            WHEN skill_daily_metrics.last_accessed_at IS NULL THEN excluded.last_accessed_at
            WHEN excluded.last_accessed_at > skill_daily_metrics.last_accessed_at THEN excluded.last_accessed_at
            ELSE skill_daily_metrics.last_accessed_at
          END,
          updated_at = excluded.updated_at
      `).bind(
        entry.skillId,
        entry.metricDate,
        accessCount,
        entry.downloadCount,
        entry.installCount,
        lastAccessedAt,
        Date.now()
      )
    );
  }

  for (const [skillId, access] of parsed.accessBySkill.entries()) {
    const skill = skillMap.get(skillId);
    if (!skill || skill.visibility !== 'public' || access.count <= 0) {
      continue;
    }

    const nextUpdateAt = resolveNextUpdateAtAfterAccess({
      tier: skill.tier,
      nextUpdateAt: skill.next_update_at,
      lastAccessedAt: skill.last_accessed_at,
      occurredAt: access.lastOccurredAt,
    });

    statements.push(
      env.DB.prepare(`
        UPDATE skills
        SET last_accessed_at = CASE
              WHEN last_accessed_at IS NULL OR last_accessed_at < ? THEN ?
              ELSE last_accessed_at
            END,
            access_count_7d = access_count_7d + ?,
            access_count_30d = access_count_30d + ?,
            next_update_at = ?
        WHERE id = ?
      `).bind(
        access.lastOccurredAt,
        access.lastOccurredAt,
        access.count,
        access.count,
        nextUpdateAt,
        skillId
      )
    );

    if (skill.tier === 'archived') {
      sideEffects.push(queueArchivedSkillResurrectionCheck(env, skillId));
      continue;
    }
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  if (sideEffects.length > 0) {
    const results = await Promise.allSettled(sideEffects);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Non-critical metrics side effect failed:', result.reason);
      }
    }
  }
}

export default {
  async queue(
    batch: MessageBatch<SkillMetricMessage>,
    env: MetricsEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    await processQueuedSkillMetrics(batch, env);
  },
};
