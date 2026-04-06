import { isCrawlerLikeRequest } from '$lib/server/request-client';

const ACCESS_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
const MAX_ACCESS_DEDUPE_ENTRIES = 10_000;

const recentAccessByClient = new Map<string, number>();

function pruneExpiredEntries(map: Map<string, number>, now: number, windowMs: number): void {
  for (const [key, timestamp] of map.entries()) {
    if (now - timestamp > windowMs) {
      map.delete(key);
    }
  }
}

export function shouldTrackSkillAccess(request: Request): boolean {
  const purpose = `${request.headers.get('purpose') || ''} ${request.headers.get('sec-purpose') || ''}`.toLowerCase();
  if (purpose.includes('prefetch')) {
    return false;
  }

  const ua = (request.headers.get('user-agent') || '').trim();
  if (!ua) {
    return false;
  }

  return !isCrawlerLikeRequest(request);
}

export function getSkillAccessClientKey(request: Request, userId: string | null): string | undefined {
  if (userId) {
    return `user:${userId}`;
  }

  const ua = (request.headers.get('user-agent') || '').slice(0, 64);
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return ua ? `ipua:${cfIp}:${ua}` : `ip:${cfIp}`;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return ua ? `ipua:${first}:${ua}` : `ip:${first}`;
    }
  }

  return ua ? `ua:${ua}` : undefined;
}

export function shouldRecordSkillAccess(
  skillId: string,
  clientKey: string | undefined,
  now: number = Date.now()
): boolean {
  if (!clientKey) {
    return true;
  }

  const dedupeKey = `${skillId}:${clientKey}`;
  const lastSeen = recentAccessByClient.get(dedupeKey);

  if (lastSeen && now - lastSeen < ACCESS_DEDUPE_WINDOW_MS) {
    return false;
  }

  recentAccessByClient.set(dedupeKey, now);
  if (recentAccessByClient.size > MAX_ACCESS_DEDUPE_ENTRIES) {
    pruneExpiredEntries(recentAccessByClient, now, ACCESS_DEDUPE_WINDOW_MS);
  }

  return true;
}
