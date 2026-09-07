import { parse as parseYaml } from 'yaml';

export type Platform = 'github' | 'gitlab';

export interface RepoSource {
  platform: Platform;
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  refKind?: 'tree' | 'blob';
  hasExplicitRef?: boolean;
  originalInput?: string;
  /**
   * Skill name extracted from aggregator URLs (e.g. https://skills.sh/owner/repo/skill-name).
   * Treated like a `--skill` filter since the in-repo path cannot be derived from the URL.
   */
  skillNameHint?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
  companionFiles?: SkillCompanionFile[];
  sha?: string;
  contentHash?: string;
}

export interface SkillCompanionFile {
  path: string; // relative to the skill directory
  content: Uint8Array;
}

export interface SkillMetadata {
  name: string;
  description: string;
  'allowed-tools'?: string[];
  model?: string;
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
  'user-invocable'?: boolean;
}

/**
 * Parse repository source from various formats
 */
export function parseSource(source: string): RepoSource | null {
  source = source.trim();
  const sshMatch = source.match(/^git@(github|gitlab)\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const parts = sshMatch[2].split('/');
    if (parts.length < 2 || (sshMatch[1] === 'github' && parts.length !== 2)
      || parts.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) return null;
    return { platform: sshMatch[1] as Platform, owner: parts.slice(0, -1).join('/'), repo: parts.at(-1)! };
  }
  // GitHub shorthand or a nested published slug: owner/repo[/path]
  const shorthandMatch = source.match(/^([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/);
  if (shorthandMatch) {
    const path = shorthandMatch[3];
    if ([shorthandMatch[1], shorthandMatch[2], ...(path?.split('/') ?? [])]
      .some((segment) => !segment || segment === '.' || segment === '..' || /[\\\s?#]/.test(segment))) {
      return null;
    }
    return {
      platform: 'github',
      owner: shorthandMatch[1],
      repo: shorthandMatch[2],
      path: path || undefined,
    };
  }

  // GitHub URL: https://github.com/owner/repo or with tree/blob refs
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (host === 'gitlab.com' || host === 'www.gitlab.com') {
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const routeIndex = parts.indexOf('-');
      const repoParts = routeIndex === -1 ? parts : parts.slice(0, routeIndex);
      if (repoParts.length < 2 || repoParts.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) return null;
      const route = routeIndex === -1 ? undefined : parts[routeIndex + 1];
      const branch = routeIndex === -1 ? undefined : parts[routeIndex + 2];
      if (routeIndex !== -1 && (!['tree', 'blob'].includes(route ?? '') || !branch)) return null;
      return {
        platform: 'gitlab', owner: repoParts.slice(0, -1).join('/'),
        repo: repoParts.at(-1)!.replace(/\.git$/, ''), branch,
        path: routeIndex === -1 ? undefined : parts.slice(routeIndex + 3).join('/') || undefined,
      };
    }
    // skills.sh URL: https://skills.sh/owner/repo or https://skills.sh/owner/repo/skill-name
    if (host === 'skills.sh' || host === 'www.skills.sh') {
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (
        parts.length >= 2
        && parts.length <= 3
        && parts.every((segment) => segment !== '.' && segment !== '..')
      ) {
        return {
          platform: 'github',
          owner: parts[0],
          repo: parts[1].replace(/\.git$/, ''),
          skillNameHint: parts[2],
          originalInput: source
        };
      }
      return null;
    }
    if (host === 'github.com' || host === 'www.github.com') {
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/, '');
        const route = parts[2];

        if (route === 'tree' || route === 'blob') {
          const branch = parts[3];
          if (!branch) return null;
          const path = parts.slice(4).join('/');
          return {
            platform: 'github',
            owner,
            repo,
            branch,
            path: path || undefined,
            refKind: route,
            hasExplicitRef: true,
            originalInput: source
          };
        }

        return {
          platform: 'github',
          owner,
          repo,
          path: parts.slice(2).join('/') || undefined,
          originalInput: source
        };
      }
    }
  } catch {
    // Not a valid URL, continue to other formats.
  }

  return null;
}

/**
 * Skill discovery directories (in order of priority)
 */
export const SKILL_DISCOVERY_PATHS = [
  '', // Root directory
  'skills',
  'skills/.curated',
  'skills/.experimental',
  'skills/.system',
  '.opencode/skill',
  '.agents',
  '.claude/skills',
  '.codex/skills',
  '.cursor/skills',
  '.agents/skills',
  '.kilocode/skills',
  '.roo/skills',
  '.goose/skills',
  '.gemini/skills',
  '.agent/skills',
  '.github/skills',
  './skills',
  '.factory/skills',
  '.windsurf/skills'
];

/**
 * Parse SKILL.md frontmatter
 */
export function parseSkillFrontmatter(content: string): SkillMetadata | null {
  const frontmatterMatch = content.replace(/^\uFEFF/, '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!frontmatterMatch) return null;
  try {
    const metadata: unknown = parseYaml(frontmatterMatch[1], { maxAliasCount: 50 });
    if (!metadata || typeof metadata !== 'object') return null;
    const fields = metadata as Record<string, unknown>;
    if (typeof fields.name !== 'string' || !fields.name.trim()
      || typeof fields.description !== 'string' || !fields.description.trim()) return null;
    return { ...fields, name: fields.name.trim(), description: fields.description.trim() } as SkillMetadata;
  } catch {
    return null;
  }
}
