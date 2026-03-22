import { SITE_URL } from '$lib/seo/constants';
import { encodeSkillSlugForPath } from '$lib/skill-path';
import type { SkillInstallData } from '$lib/types';

export interface SkillInstallTarget {
  slug: string;
  name?: string | null;
  skillName?: string | null;
  skillPath?: string | null;
  sourceType?: 'github' | 'upload' | null;
  repoOwner?: string | null;
  repoName?: string | null;
  visibility?: 'public' | 'private' | 'unlisted' | null;
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

function resolveSkillName(target: SkillInstallTarget): string | null {
  return target.skillName ?? target.name ?? null;
}

function needsVercelSkillSelector(target: SkillInstallTarget, repoSource: string): boolean {
  const skillName = resolveSkillName(target);
  if (target.sourceType !== 'github' || !skillName) return false;
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
  const skillName = resolveSkillName(target);
  if (repoSource && hasNestedGitHubSkillPath(target) && skillName) {
    return `npx skillscat add ${repoSource} --skill ${quoteShellArgument(skillName)}`;
  }
  if (repoSource && target.sourceType === 'github' && target.slug === repoSource) {
    return `npx skillscat add ${repoSource}`;
  }
  return `npx skillscat add ${target.slug}`;
}

export function buildVercelSkillsInstallCommand(target: SkillInstallTarget): string | null {
  const repoSource = buildRepoSource(target);
  if (!repoSource || target.sourceType !== 'github') return null;
  const skillName = resolveSkillName(target);

  if (needsVercelSkillSelector(target, repoSource)) {
    return `npx skills add ${repoSource} --skill ${quoteShellArgument(skillName!)}`;
  }

  return `npx skills add ${repoSource}`;
}

function buildSkillPageUrl(slug: string): string {
  return `${SITE_URL}/skills/${encodeSkillSlugForPath(slug)}`;
}

function buildSkillFilesUrl(slug: string): string {
  return `${SITE_URL}/api/skills/${encodeURIComponent(slug)}/files`;
}

function buildAgentVisibilityNote(target: SkillInstallTarget): string | null {
  if (target.visibility === 'private') {
    return 'This skill is private. If authentication is required, ask me to run npx skillscat login first and then continue.';
  }

  if (target.visibility === 'unlisted') {
    return 'This skill is unlisted. Use the exact slug and page URL instead of relying on public search.';
  }

  return null;
}

export function buildAgentInstallPrompt(target: SkillInstallTarget): string {
  const skillscatCommand = buildSkillscatInstallCommand(target);
  const preferredCommand = buildVercelSkillsInstallCommand(target) || skillscatCommand;
  const fallbackCommand = preferredCommand === skillscatCommand ? null : skillscatCommand;
  const visibilityNote = buildAgentVisibilityNote(target);
  const lines = [
    'Install this SkillsCat skill into the current workspace.',
    '',
    `Skill: ${resolveSkillName(target) || target.slug}`,
    `Slug: ${target.slug}`,
  ];

  if (target.repoOwner && target.repoName) {
    lines.push(`Repository: ${target.repoOwner}/${target.repoName}`);
  }

  lines.push(`Skill page: ${buildSkillPageUrl(target.slug)}`);
  lines.push('');
  lines.push('Preferred command:');
  lines.push(preferredCommand);

  if (fallbackCommand) {
    lines.push('');
    lines.push('Fallback command:');
    lines.push(fallbackCommand);
  }

  if (visibilityNote) {
    lines.push('');
    lines.push(visibilityNote);
  }

  lines.push('');
  lines.push('If CLI installation is not possible, use this SkillsCat bundle endpoint instead and preserve nested file paths exactly:');
  lines.push(buildSkillFilesUrl(target.slug));
  lines.push('');
  lines.push('After installing, tell me where the skill was written and what changed.');

  return lines.join('\n');
}

export function buildSkillInstallData(target: SkillInstallTarget): SkillInstallData {
  const cli: SkillInstallData['cli'] = [
    {
      id: 'skillscat',
      command: buildSkillscatInstallCommand(target),
    },
  ];

  if (target.visibility === 'public') {
    const vercelCommand = buildVercelSkillsInstallCommand(target);
    if (vercelCommand) {
      cli.push({
        id: 'skills',
        command: vercelCommand,
      });
    }
  }

  return {
    cli,
    agentPrompt: buildAgentInstallPrompt(target),
  };
}
