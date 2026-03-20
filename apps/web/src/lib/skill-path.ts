function normalizeSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function splitSegments(value: string): string[] {
  const normalized = normalizeSegment(value);
  if (!normalized) return [];
  return normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface SkillSlugParts {
  owner: string;
  name: string;
  slug: string;
}

export function normalizeSkillOwner(owner: string): string {
  return normalizeSegment(owner).replace(/^@+/, '');
}

export function normalizeSkillName(name: string): string {
  return splitSegments(name).join('/');
}

export function buildSkillSlug(owner: string, name: string): string {
  const normalizedOwner = normalizeSkillOwner(owner);
  const normalizedName = normalizeSkillName(name);
  if (!normalizedOwner || !normalizedName) return '';
  return `${normalizedOwner}/${normalizedName}`;
}

export function parseSkillSlug(slug: string): SkillSlugParts | null {
  const parts = splitSegments(slug);
  if (parts.length < 2) return null;

  const [owner, ...nameParts] = parts;
  const normalizedSlug = buildSkillSlug(owner, nameParts.join('/'));
  if (!normalizedSlug) return null;

  const [normalizedOwner, ...normalizedNameParts] = normalizedSlug.split('/');
  return {
    owner: normalizedOwner,
    name: normalizedNameParts.join('/'),
    slug: normalizedSlug,
  };
}

export function normalizeSkillSlug(slug: string): string {
  return parseSkillSlug(slug)?.slug || '';
}

export function encodeSkillSlugForPath(slug: string): string {
  const parts = parseSkillSlug(slug);
  if (!parts) return '';

  const encodedName = parts.name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  // URL shape is /skills/[owner]/[name...], with each segment encoded independently.
  return `${encodeURIComponent(parts.owner)}/${encodedName}`;
}

export function buildSkillPath(slug: string): string {
  const encoded = encodeSkillSlugForPath(slug);
  return encoded ? `/skills/${encoded}` : '/search';
}

export function buildSkillPathFromOwnerAndName(owner: string, name: string): string {
  const slug = buildSkillSlug(owner, name);
  if (!slug) return '/search';
  return buildSkillPath(slug);
}

export function buildUploadSkillR2Prefix(slug: string): string {
  const parts = parseSkillSlug(slug);
  if (!parts) return '';
  return `skills/${parts.owner}/${parts.name}/`;
}

export function buildUploadSkillR2Key(slug: string, filePath: string): string {
  const prefix = buildUploadSkillR2Prefix(slug);
  if (!prefix) return '';
  const normalizedFilePath = filePath.replace(/^\/+/, '');
  return `${prefix}${normalizedFilePath}`;
}

function normalizeGithubRepoCachePart(value: string): string {
  return normalizeSegment(value);
}

function normalizeGithubSkillCachePath(skillPath: string | null | undefined): string {
  return splitSegments(String(skillPath ?? '')).join('/');
}

function buildGithubSkillCacheSegment(skillPath: string | null | undefined): string {
  const normalizedSkillPath = normalizeGithubSkillCachePath(skillPath);
  return normalizedSkillPath ? `p:${encodeURIComponent(normalizedSkillPath)}` : '_root_';
}

export function buildGithubSkillR2Prefix(
  repoOwner: string,
  repoName: string,
  skillPath?: string | null
): string {
  const owner = normalizeGithubRepoCachePart(repoOwner);
  const repo = normalizeGithubRepoCachePart(repoName);
  if (!owner || !repo) return '';
  return `skills/github/${owner}/${repo}/${buildGithubSkillCacheSegment(skillPath)}/`;
}

export function buildGithubSkillR2Key(
  repoOwner: string,
  repoName: string,
  skillPath: string | null | undefined,
  filePath: string
): string {
  const prefix = buildGithubSkillR2Prefix(repoOwner, repoName, skillPath);
  if (!prefix) return '';
  const normalizedFilePath = filePath.replace(/^\/+/, '');
  return `${prefix}${normalizedFilePath}`;
}

export function buildLegacyGithubSkillR2Prefix(
  repoOwner: string,
  repoName: string,
  skillPath?: string | null
): string {
  const owner = normalizeGithubRepoCachePart(repoOwner);
  const repo = normalizeGithubRepoCachePart(repoName);
  if (!owner || !repo) return '';
  const normalizedSkillPath = normalizeGithubSkillCachePath(skillPath);
  return normalizedSkillPath ? `skills/${owner}/${repo}/${normalizedSkillPath}/` : `skills/${owner}/${repo}/`;
}

export function buildLegacyGithubSkillR2Key(
  repoOwner: string,
  repoName: string,
  skillPath: string | null | undefined,
  filePath: string
): string {
  const prefix = buildLegacyGithubSkillR2Prefix(repoOwner, repoName, skillPath);
  if (!prefix) return '';
  const normalizedFilePath = filePath.replace(/^\/+/, '');
  return `${prefix}${normalizedFilePath}`;
}

export function buildGithubSkillR2Prefixes(
  repoOwner: string,
  repoName: string,
  skillPath?: string | null
): string[] {
  const paths = new Set<string>();
  const canonical = buildGithubSkillR2Prefix(repoOwner, repoName, skillPath);
  if (canonical) {
    paths.add(canonical);
  }

  const legacy = buildLegacyGithubSkillR2Prefix(repoOwner, repoName, skillPath);
  if (legacy) {
    paths.add(legacy);
  }

  const ownerLower = normalizeGithubRepoCachePart(repoOwner).toLowerCase();
  const repoLower = normalizeGithubRepoCachePart(repoName).toLowerCase();
  if (ownerLower && repoLower) {
    const lowerLegacy = buildLegacyGithubSkillR2Prefix(ownerLower, repoLower, skillPath);
    if (lowerLegacy) {
      paths.add(lowerLegacy);
    }
  }

  return [...paths];
}

export function buildGithubSkillR2Keys(
  repoOwner: string,
  repoName: string,
  skillPath: string | null | undefined,
  filePath: string
): string[] {
  const normalizedFilePath = filePath.replace(/^\/+/, '');
  return buildGithubSkillR2Prefixes(repoOwner, repoName, skillPath)
    .map((prefix) => `${prefix}${normalizedFilePath}`);
}

export function getCanonicalSkillPathFromPathname(pathname: string): string | null {
  const pathOnly = pathname.replace(/\/+$/, '') || '/';
  const segments = pathOnly.split('/').filter(Boolean);
  if (segments[0] !== 'skills' || segments.length < 3) {
    return null;
  }

  const owner = safeDecodeURIComponent(segments[1] || '');
  const name = segments.slice(2).map((segment) => safeDecodeURIComponent(segment)).join('/');
  const canonical = buildSkillPathFromOwnerAndName(owner, name);
  return canonical === '/search' ? null : canonical;
}
