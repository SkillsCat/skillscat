const ACCESS_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
const MAX_QUEUE_SEND_FAILURE_LOGS = 20;

export type SkillMetricKind = 'access' | 'download' | 'install';

export interface SkillMetricMessage {
  type: 'skill_metric';
  metric: SkillMetricKind;
  skillId: string;
  occurredAt: number;
  dedupeKey?: string;
}

type WaitUntilFn = (promise: Promise<unknown>) => void;
type QueueSendFailureHandler = (error: unknown) => Promise<unknown> | unknown;

let queueSendFailureLogs = 0;

function hashMetricKey(value: string): string {
  let hash = 5381;

  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }

  return (hash >>> 0).toString(36);
}

export function buildSkillMetricDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function buildSkillAccessDedupeKey(skillId: string, clientKey: string, occurredAt: number): string {
  const windowBucket = Math.floor(occurredAt / ACCESS_DEDUPE_WINDOW_MS);
  return `${skillId}:${windowBucket}:${hashMetricKey(clientKey)}`;
}

export function buildSkillMetricMessage(
  metric: SkillMetricKind,
  skillId: string,
  options?: {
    occurredAt?: number;
    dedupeKey?: string;
  }
): SkillMetricMessage {
  return {
    type: 'skill_metric',
    metric,
    skillId,
    occurredAt: options?.occurredAt ?? Date.now(),
    dedupeKey: options?.dedupeKey,
  };
}

export function enqueueSkillMetric(
  queue: Queue<SkillMetricMessage> | undefined,
  message: SkillMetricMessage,
  options?: {
    waitUntil?: WaitUntilFn;
    onError?: QueueSendFailureHandler;
  }
): boolean {
  if (!queue) {
    return false;
  }

  const sendPromise = Promise.resolve()
    .then(() => queue.send(message))
    .catch(async (error) => {
      if (queueSendFailureLogs < MAX_QUEUE_SEND_FAILURE_LOGS) {
        queueSendFailureLogs += 1;
        console.error('Failed to enqueue skill metric:', error);
      }

      if (!options?.onError) {
        return;
      }

      try {
        await options.onError(error);
      } catch (fallbackError) {
        console.error('Failed to recover from skill metric enqueue error:', fallbackError);
      }
    });

  if (options?.waitUntil) {
    options.waitUntil(sendPromise);
  } else {
    void sendPromise;
  }

  return true;
}
