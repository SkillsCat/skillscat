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
  // GitHub shorthand: owner/repo
  const shorthandMatch = source.match(/^([^\/\s]+)\/([^\/\s]+)$/);
  if (shorthandMatch) {
    return {
      platform: 'github',
      owner: shorthandMatch[1],
      repo: shorthandMatch[2]
    };
  }

  // GitHub URL: https://github.com/owner/repo or with tree/blob refs
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase();
    if (host === 'github.com' || host === 'www.github.com') {
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/, '');
        const route = parts[2];

        if (route === 'tree' || route === 'blob') {
          const branch = parts[3];
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

  // GitLab URL: https://gitlab.com/owner/repo or with -/tree/branch/path
  const gitlabMatch = source.match(
    /gitlab\.com\/(.+?)(?:\/-\/tree\/([^\/]+))?(?:\/(.+))?$/
  );
  if (gitlabMatch) {
    const fullPath = gitlabMatch[1];
    const parts = fullPath.split('/').filter(p => p && !p.startsWith('-'));
    if (parts.length >= 2) {
      const repo = parts.pop()!.replace(/\.git$/, '');
      const owner = parts.join('/');
      return {
        platform: 'gitlab',
        owner,
        repo,
        branch: gitlabMatch[2],
        path: gitlabMatch[3]
      };
    }
  }

  // Git SSH URL: git@github.com:owner/repo.git
  const sshMatch = source.match(/git@(github|gitlab)\.com:([^\/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      platform: sshMatch[1] as Platform,
      owner: sshMatch[2],
      repo: sshMatch[3]
    };
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
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];
  const metadata: Partial<SkillMetadata> = {};

  // Parse name
  const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  if (nameMatch) metadata.name = nameMatch[1].trim();

  // Parse description
  const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  if (descMatch) metadata.description = descMatch[1].trim();

  // Parse allowed-tools
  const toolsMatch = frontmatter.match(/^allowed-tools:\s*\[([^\]]+)\]/m);
  if (toolsMatch) {
    metadata['allowed-tools'] = toolsMatch[1].split(',').map(t => t.trim().replace(/["']/g, ''));
  }

  // Parse model
  const modelMatch = frontmatter.match(/^model:\s*["']?(.+?)["']?\s*$/m);
  if (modelMatch) metadata.model = modelMatch[1].trim();

  // Parse context
  const contextMatch = frontmatter.match(/^context:\s*["']?(.+?)["']?\s*$/m);
  if (contextMatch && contextMatch[1].trim() === 'fork') metadata.context = 'fork';

  if (!metadata.name || !metadata.description) return null;

  return metadata as SkillMetadata;
}
