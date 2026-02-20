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

  // URL shape is always /skills/[owner]/[name], where name may include "/" in slug.
  return `${encodeURIComponent(parts.owner)}/${encodeURIComponent(parts.name)}`;
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

export function getCanonicalSkillPathFromPathname(pathname: string): string | null {
  const pathOnly = pathname.replace(/\/+$/, '') || '/';
  const segments = pathOnly.split('/').filter(Boolean);
  if (segments[0] !== 'skills' || segments.length < 4) {
    return null;
  }

  const owner = safeDecodeURIComponent(segments[1] || '');
  const name = segments.slice(2).map((segment) => safeDecodeURIComponent(segment)).join('/');
  const canonical = buildSkillPathFromOwnerAndName(owner, name);
  return canonical === '/search' ? null : canonical;
}
