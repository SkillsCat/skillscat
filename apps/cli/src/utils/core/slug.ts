/**
 * Parse a skill slug into owner and name components
 * @param slug - Skill slug in format "owner/name"
 * @returns Object with owner and name
 * @throws Error if slug format is invalid
 */
export function parseSlug(slug: string): { owner: string; name: string } {
  const match = slug.match(/^([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid slug format: ${slug}. Expected format: owner/name`);
  }
  return { owner: match[1], name: match[2] };
}

/**
 * Build a two-segment API path from a slug
 * @param slug - Skill slug in format "owner/name"
 * @returns Path segment like "owner/name" (without leading slash)
 */
export function slugToPath(slug: string): string {
  const { owner, name } = parseSlug(slug);
  return `${owner}/${name}`;
}
