function normalizeSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

export function normalizeSkillSlug(slug: string): string {
  const normalized = normalizeSegment(slug);
  if (!normalized) return '';

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return '';

  const [owner, ...nameParts] = parts;
  const normalizedOwner = owner.replace(/^@+/, '');
  if (!normalizedOwner) return '';

  return [normalizedOwner, ...nameParts].join('/');
}

export function normalizeSkillOwner(owner: string): string {
  return normalizeSegment(owner).replace(/^@+/, '');
}

export function encodeSkillSlugForPath(slug: string): string {
  const normalized = normalizeSkillSlug(slug);
  if (!normalized) return '';

  return normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildSkillPath(slug: string): string {
  const encoded = encodeSkillSlugForPath(slug);
  return encoded ? `/skills/${encoded}` : '/search';
}
