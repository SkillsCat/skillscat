import type { SkillFile } from '$lib/server/skill/files';
import { buildClawHubCompatVersion } from '$lib/server/openclaw/clawhub-compat';

export const OPENCLAW_REGISTRY_BASE_PATH = '/openclaw';
export const OPENCLAW_DEFAULT_LIMIT = 25;
export const OPENCLAW_MAX_LIMIT = 200;
const OPENCLAW_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type OpenClawSort =
  | 'updated'
  | 'downloads'
  | 'stars'
  | 'installsCurrent'
  | 'installsAllTime'
  | 'trending';

export function buildOpenClawResponseHeaders(opts: {
  cacheControl: string;
  cacheStatus?: 'HIT' | 'MISS' | 'BYPASS';
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': opts.cacheControl,
    Vary: 'Authorization',
  };

  if (opts.cacheStatus) {
    headers['X-Cache'] = opts.cacheStatus;
  }

  return headers;
}

export function parseOpenClawLimit(raw: string | null | undefined): number {
  const parsed = Number.parseInt(String(raw ?? OPENCLAW_DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return OPENCLAW_DEFAULT_LIMIT;
  }
  return Math.min(parsed, OPENCLAW_MAX_LIMIT);
}

export function parseOpenClawCursor(raw: string | null | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function buildOpenClawNextCursor(offset: number, limit: number, hasMore: boolean): string | null {
  if (!hasMore) return null;
  return String(offset + limit);
}

export function normalizeOpenClawSort(raw: string | null | undefined): OpenClawSort {
  const normalized = String(raw ?? '').trim().toLowerCase();

  if (!normalized || normalized === 'updated' || normalized === 'newest') {
    return 'updated';
  }
  if (normalized === 'downloads' || normalized === 'download') {
    return 'downloads';
  }
  if (normalized === 'stars' || normalized === 'star' || normalized === 'rating') {
    return 'stars';
  }
  if (
    normalized === 'installs' ||
    normalized === 'install' ||
    normalized === 'installscurrent' ||
    normalized === 'installs-current' ||
    normalized === 'current'
  ) {
    return 'installsCurrent';
  }
  if (normalized === 'installsalltime' || normalized === 'installs-all-time') {
    return 'installsAllTime';
  }
  if (normalized === 'trending') {
    return 'trending';
  }

  return 'updated';
}

export function getOpenClawSortSql(sort: OpenClawSort): string {
  const updatedExpr = 'CASE WHEN last_commit_at IS NULL THEN updated_at ELSE last_commit_at END';

  switch (sort) {
    case 'downloads':
      return `download_count_90d DESC, download_count_30d DESC, stars DESC, ${updatedExpr} DESC, slug ASC`;
    case 'stars':
      return `stars DESC, download_count_90d DESC, download_count_30d DESC, ${updatedExpr} DESC, slug ASC`;
    case 'installsCurrent':
      return `download_count_30d DESC, download_count_90d DESC, stars DESC, ${updatedExpr} DESC, slug ASC`;
    case 'installsAllTime':
      return `download_count_90d DESC, download_count_30d DESC, stars DESC, ${updatedExpr} DESC, slug ASC`;
    case 'trending':
      return `trending_score DESC, download_count_30d DESC, ${updatedExpr} DESC, slug ASC`;
    case 'updated':
    default:
      return `${updatedExpr} DESC, slug ASC`;
  }
}

export function getOpenClawIndexHint(sort: OpenClawSort): string {
  switch (sort) {
    case 'downloads':
    case 'installsAllTime':
      return 'skills_public_openclaw_downloads_rank_idx';
    case 'installsCurrent':
      return 'skills_public_openclaw_installs_current_rank_idx';
    case 'stars':
      return 'skills_public_openclaw_stars_rank_idx';
    case 'trending':
      return 'skills_public_openclaw_trending_rank_idx';
    case 'updated':
    default:
      return 'skills_public_openclaw_updated_slug_idx';
  }
}

export function buildOpenClawLatestVersion(input: {
  updatedAt: number | null | undefined;
  createdAt?: number | null | undefined;
  changelog?: string | null | undefined;
  version?: string | null | undefined;
  changelogSource?: 'auto' | 'user' | null | undefined;
  license?: 'MIT-0' | null | undefined;
}) {
  const version = input.version || buildClawHubCompatVersion(input.updatedAt);
  return {
    version,
    createdAt: Number(input.updatedAt ?? input.createdAt ?? 0),
    changelog: input.changelog || 'Synced from the latest SkillsCat bundle.',
    changelogSource: input.changelogSource || 'auto',
    license: input.license ?? null,
  };
}

export function buildOpenClawTags(updatedAt: number | null | undefined): Record<string, string> {
  return {
    latest: buildClawHubCompatVersion(updatedAt),
  };
}

export function buildOpenClawStats(input: {
  stars?: number | null | undefined;
  downloadCount90d?: number | null | undefined;
  downloadCount30d?: number | null | undefined;
}): Record<string, number> {
  return {
    downloads: Number(input.downloadCount90d ?? 0),
    installsCurrent: Number(input.downloadCount30d ?? 0),
    installsAllTime: Number(input.downloadCount90d ?? 0),
    stars: Number(input.stars ?? 0),
    versions: 1,
    comments: 0,
  };
}

export function isSupportedOpenClawTag(raw: string | null | undefined): boolean {
  if (!raw) return true;
  return raw.trim().toLowerCase() === 'latest';
}

export function matchesOpenClawVersion(
  requestedVersion: string | null | undefined,
  updatedAt: number | null | undefined
): boolean {
  if (!requestedVersion) return true;
  return requestedVersion.trim() === buildClawHubCompatVersion(updatedAt);
}

export function guessOpenClawTextContentType(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (normalized.endsWith('.json')) return 'application/json; charset=utf-8';
  if (normalized.endsWith('.yaml') || normalized.endsWith('.yml')) {
    return 'application/yaml; charset=utf-8';
  }
  if (normalized.endsWith('.toml')) return 'application/toml; charset=utf-8';
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.html')) return 'text/html; charset=utf-8';
  if (normalized.endsWith('.css')) return 'text/css; charset=utf-8';
  if (normalized.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx')) {
    return 'text/plain; charset=utf-8';
  }
  return 'text/plain; charset=utf-8';
}

export function isValidOpenClawSemver(value: string | null | undefined): boolean {
  if (!value) return false;
  return OPENCLAW_SEMVER_PATTERN.test(value.trim());
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildOpenClawVersionFiles(files: SkillFile[]) {
  return Promise.all(
    files.map(async (file) => ({
      path: file.path,
      size: new TextEncoder().encode(file.content).byteLength,
      sha256: await sha256Hex(file.content),
      contentType: guessOpenClawTextContentType(file.path),
    }))
  );
}
