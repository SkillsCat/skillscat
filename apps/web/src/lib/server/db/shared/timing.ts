import type { TimingCollector } from '$lib/server/db/shared/types';

export function collectTiming(
  collector: TimingCollector | undefined,
  name: string,
  start: number,
  desc?: string
): void {
  if (!collector) return;
  collector(name, Math.max(0, performance.now() - start), desc);
}

export async function timedTask<T>(
  collector: TimingCollector | undefined,
  name: string,
  task: () => Promise<T>,
  desc?: string
): Promise<T> {
  const start = performance.now();
  try {
    return await task();
  } finally {
    collectTiming(collector, name, start, desc);
  }
}
