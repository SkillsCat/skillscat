function normalizeSkillTreePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export function getNestedSkillPaths(treePaths: string[]): string[] {
  const nestedSkillPaths = new Set<string>();

  for (const path of treePaths) {
    const normalizedPath = normalizeSkillTreePath(path);
    const fileName = normalizedPath.split('/').pop()?.toLowerCase();
    if (fileName !== 'skill.md') continue;

    const parts = normalizedPath.split('/');
    parts.pop();
    const skillPath = parts.join('/');
    if (skillPath) {
      nestedSkillPaths.add(skillPath);
    }
  }

  return [...nestedSkillPaths].sort((left, right) => right.length - left.length);
}

export function resolveSkillRelativePath(
  itemPath: string,
  skillPath: string | null | undefined,
  _nestedSkillPaths: string[] = []
): string | null {
  const normalizedItemPath = normalizeSkillTreePath(itemPath);
  const normalizedSkillPath = normalizeSkillTreePath(skillPath || '');

  if (normalizedSkillPath) {
    const prefix = `${normalizedSkillPath}/`;
    if (!normalizedItemPath.startsWith(prefix)) {
      return null;
    }
    return normalizedItemPath.slice(prefix.length);
  }

  return normalizedItemPath;
}
