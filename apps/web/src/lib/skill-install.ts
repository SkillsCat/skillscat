export interface SkillInstallTarget {
  slug: string;
  skillName?: string | null;
  skillPath?: string | null;
  sourceType?: 'github' | 'upload' | null;
  repoOwner?: string | null;
  repoName?: string | null;
}

const SAFE_SHELL_ARGUMENT_RE = /^[A-Za-z0-9_./:@%+-]+$/;
const COMMAND_TOKEN_RE = /"(?:\\.|[^"\\])*"|'(?:[^']*)'|[^\s]+/g;

function normalizeSkillPath(path?: string | null): string {
  if (!path) return '';
  const normalized = path.replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  return normalized.replace(/(?:^|\/)SKILL\.md$/i, '');
}

function buildRepoSource(target: SkillInstallTarget): string | null {
  if (!target.repoOwner || !target.repoName) return null;
  return `${target.repoOwner}/${target.repoName}`;
}

function hasNestedGitHubSkillPath(target: SkillInstallTarget): boolean {
  return target.sourceType === 'github' && Boolean(normalizeSkillPath(target.skillPath));
}

function needsVercelSkillSelector(target: SkillInstallTarget, repoSource: string): boolean {
  if (target.sourceType !== 'github' || !target.skillName) return false;
  return hasNestedGitHubSkillPath(target) || target.slug !== repoSource;
}

export function quoteShellArgument(value: string): string {
  if (value.length === 0) return '""';
  if (SAFE_SHELL_ARGUMENT_RE.test(value)) return value;
  return `"${value.replace(/["\\$`]/g, '\\$&')}"`;
}

export function splitShellCommand(command: string): string[] {
  return command.match(COMMAND_TOKEN_RE) ?? [];
}

export function buildSkillscatInstallCommand(target: SkillInstallTarget): string {
  const repoSource = buildRepoSource(target);
  if (repoSource && hasNestedGitHubSkillPath(target) && target.skillName) {
    return `npx skillscat add ${repoSource} --skill ${quoteShellArgument(target.skillName!)}`;
  }
  if (repoSource && target.sourceType === 'github' && target.slug === repoSource) {
    return `npx skillscat add ${repoSource}`;
  }
  return `npx skillscat add ${target.slug}`;
}

export function buildVercelSkillsInstallCommand(target: SkillInstallTarget): string | null {
  const repoSource = buildRepoSource(target);
  if (!repoSource || target.sourceType !== 'github') return null;

  if (needsVercelSkillSelector(target, repoSource)) {
    return `npx skills add ${repoSource} --skill ${quoteShellArgument(target.skillName!)}`;
  }

  return `npx skills add ${repoSource}`;
}
