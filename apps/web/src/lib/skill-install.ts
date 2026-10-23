import { SITE_URL } from '$lib/seo/constants';
import { encodeSkillSlugForPath } from '$lib/skill-path';
import type { SkillInstallData } from '$lib/types';
import type { SupportedLocale } from '$lib/i18n/config';

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

export function buildSkillscatRepoInstallCommand(target: SkillInstallTarget): string {
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

export function buildSkillscatInstallCommand(target: SkillInstallTarget): string {
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

function buildAgentVisibilityNote(target: SkillInstallTarget, locale: SupportedLocale): string | null {
  if (target.visibility === 'private') {
    if (locale === 'ca') {
      return 'Aquest skill és privat. Si cal autenticar-se, demana’m que executi npx skillscat login abans de continuar.';
    }
    return 'This skill is private. If authentication is required, ask me to run npx skillscat login first and then continue.';
  }

  if (target.visibility === 'unlisted') {
    if (locale === 'ca') {
      return 'Aquest skill no és llistat. Fes servir l’slug exacte i l’URL de la fitxa en lloc de cercar-lo al catàleg públic.';
    }
    return 'This skill is unlisted. Use the exact slug and page URL instead of relying on public search.';
  }

  return null;
}

export function buildAgentInstallPrompt(target: SkillInstallTarget, locale: SupportedLocale = 'en'): string {
  const skillscatCommand = buildSkillscatInstallCommand(target);
  const visibilityNote = buildAgentVisibilityNote(target, locale);
  const catalan = locale === 'ca';
  const lines = [
    catalan ? 'Instal·la aquest skill de SkillsCat a l’espai de treball actual.' : 'Install this SkillsCat skill into the current workspace.',
    '',
    `Skill: ${resolveSkillName(target) || target.slug}`,
    `Slug: ${target.slug}`,
  ];

  if (target.repoOwner && target.repoName) {
    lines.push(`${catalan ? 'Repositori' : 'Repository'}: ${target.repoOwner}/${target.repoName}`);
  }

  lines.push(`${catalan ? 'Fitxa de l’skill' : 'Skill page'}: ${buildSkillPageUrl(target.slug)}`);
  lines.push('');
  lines.push(catalan ? 'Ordre:' : 'Command:');
  lines.push(`${skillscatCommand} --yes`);

  if (visibilityNote) {
    lines.push('');
    lines.push(visibilityNote);
  }

  lines.push('');
  lines.push(catalan
    ? 'Si no es pot instal·lar amb la CLI o l’ordre supera el temps d’espera, utilitza aquest punt d’accés al paquet de SkillsCat i conserva exactament les rutes dels fitxers, inclosos els subdirectoris:'
    : 'If CLI installation is not possible or the command times out, use this SkillsCat bundle endpoint instead and preserve nested file paths exactly:');
  lines.push(buildSkillFilesUrl(target.slug));
  lines.push('');
  lines.push(catalan ? 'Després d’instal·lar-lo, indica’m on s’ha desat l’skill i quins canvis s’han fet.' : 'After installing, tell me where the skill was written and what changed.');

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
