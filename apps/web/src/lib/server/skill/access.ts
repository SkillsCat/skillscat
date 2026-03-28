const BOT_UA_PATTERN = /\b(bot|crawler|spider|slurp|preview|headless|lighthouse)\b/i;

export function shouldTrackSkillAccess(request: Request): boolean {
  const purpose = `${request.headers.get('purpose') || ''} ${request.headers.get('sec-purpose') || ''}`.toLowerCase();
  if (purpose.includes('prefetch')) {
    return false;
  }

  const ua = (request.headers.get('user-agent') || '').trim();
  if (!ua) {
    return false;
  }

  return !BOT_UA_PATTERN.test(ua);
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
