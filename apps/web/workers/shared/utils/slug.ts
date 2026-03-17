export function generateId(): string {
  return crypto.randomUUID();
}

export function generateSlug(
  owner: string,
  name: string,
  skillPath?: string,
  displayName?: string
): string {
  const sanitize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  let slug = `${sanitize(owner)}/${sanitize(name)}`;

  if (skillPath) {
    const normalizedPath = skillPath.replace(/^\/|\/$/g, '');

    if (displayName) {
      slug = `${slug}/${sanitize(displayName)}`;
    } else {
      slug = `${slug}/${sanitize(normalizedPath.replace(/\//g, '-'))}`;
    }
  }

  return slug;
}

export async function checkSlugCollision(
  db: D1Database,
  slug: string,
  excludeSkillId?: string
): Promise<boolean> {
  const query = excludeSkillId
    ? 'SELECT id FROM skills WHERE slug = ? AND id != ? LIMIT 1'
    : 'SELECT id FROM skills WHERE slug = ? LIMIT 1';

  const result = excludeSkillId
    ? await db.prepare(query).bind(slug, excludeSkillId).first()
    : await db.prepare(query).bind(slug).first();

  return result !== null;
}
