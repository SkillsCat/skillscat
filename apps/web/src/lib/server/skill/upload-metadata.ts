const MAX_UPLOAD_CATEGORIES = 12;
const MAX_CATEGORY_SLUG_LENGTH = 64;
const MAX_UPLOAD_SKILL_NAME_LENGTH = 200;

export function resolveUploadedSkillName(
  override: string | null | undefined,
  extracted: string | null | undefined
): string | null {
  const name = override?.trim() || extracted?.trim() || 'untitled-skill';
  if (name.length > MAX_UPLOAD_SKILL_NAME_LENGTH) return null;
  if (!/[a-z0-9]/.test(name.toLowerCase())) return null;
  return name;
}

export function normalizeUploadedCategorySlugs(values: Iterable<string>): string[] {
  const categories = new Set<string>();

  for (const value of values) {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!slug || slug.length > MAX_CATEGORY_SLUG_LENGTH) continue;
    categories.add(slug);
    if (categories.size >= MAX_UPLOAD_CATEGORIES) break;
  }

  return [...categories];
}
