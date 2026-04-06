const AVATAR_PROXY_PATH = '/avatar';
const DEFAULT_AVATAR_SIZE = 96;
const MIN_AVATAR_SIZE = 16;
const MAX_AVATAR_SIZE = 512;
const GITHUB_AVATAR_HOST = 'avatars.githubusercontent.com';
const GITHUB_HOST = 'github.com';

function extractGitHubLoginFromPngPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)\.png$/i);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function clampAvatarSize(size: number | null | undefined): number {
  if (!Number.isFinite(size)) return DEFAULT_AVATAR_SIZE;
  return Math.min(MAX_AVATAR_SIZE, Math.max(MIN_AVATAR_SIZE, Math.round(Number(size))));
}

export function isSupportedPublicAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === GITHUB_AVATAR_HOST) return true;
    if (parsed.hostname !== GITHUB_HOST) return false;
    return extractGitHubLoginFromPngPath(parsed.pathname) !== null;
  } catch {
    return false;
  }
}

export function normalizePublicAvatarUrl(
  url: string | null | undefined,
  requestedSize: number | null | undefined,
): string | null {
  if (!url) return null;

  const size = clampAvatarSize(requestedSize);

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return url;

    if (parsed.hostname === GITHUB_AVATAR_HOST) {
      const currentSize = Number(parsed.searchParams.get('s'));
      if (!Number.isFinite(currentSize) || currentSize <= 0 || currentSize > size) {
        parsed.searchParams.set('s', String(size));
      }
      return parsed.toString();
    }

    if (parsed.hostname === GITHUB_HOST) {
      const login = extractGitHubLoginFromPngPath(parsed.pathname);
      if (!login) return url;
      return `https://${GITHUB_AVATAR_HOST}/${encodeURIComponent(login)}?s=${size}`;
    }

    return url;
  } catch {
    return url;
  }
}

export function buildAvatarProxyUrl(
  url: string,
  requestedSize: number | null | undefined,
): string {
  const size = clampAvatarSize(requestedSize);
  const normalized = normalizePublicAvatarUrl(url, size) || url;
  const params = new URLSearchParams();
  params.set('u', normalized);
  params.set('s', String(size));
  return `${AVATAR_PROXY_PATH}?${params.toString()}`;
}

export function resolvePublicAvatarUrl(options: {
  src?: string | null;
  fallback?: string | null;
  useGithubFallback?: boolean;
  requestedSize?: number | null;
}): string | null {
  const size = clampAvatarSize(options.requestedSize);
  const fallbackUrl = options.useGithubFallback && options.fallback
    ? `https://${GITHUB_AVATAR_HOST}/${encodeURIComponent(options.fallback)}?s=${size}`
    : null;
  const rawUrl = options.src || fallbackUrl;
  const normalized = normalizePublicAvatarUrl(rawUrl, size);

  if (!normalized) return null;
  if (!isSupportedPublicAvatarUrl(normalized)) return normalized;

  return buildAvatarProxyUrl(normalized, size);
}
