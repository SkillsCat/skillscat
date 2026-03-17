import { buildSkillPath, encodeSkillSlugForPath } from '$lib/skill-path';
import { buildSkillscatInstallCommand, type SkillInstallTarget } from '$lib/skill-install';
import { SITE_URL } from '$lib/seo/constants';
import type { SkillDetail } from '$lib/types';
import { buildLlmTxt } from '$lib/server/llm-txt';

const OPENCLAW_UA_PATTERN = /\bopenclaw(?:[\/\s-]|$)/i;

function buildOpenClawInstallCommand(skill: SkillDetail): string {
  const target: SkillInstallTarget = {
    slug: skill.slug,
    skillName: skill.name,
    skillPath: skill.skillPath,
    sourceType: skill.sourceType,
    repoOwner: skill.repoOwner,
    repoName: skill.repoName,
  };

  return `${buildSkillscatInstallCommand(target)} --agent openclaw`;
}

function buildFolderName(skillName: string): string {
  return skillName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase() || 'skill';
}

function formatCategories(categories: string[]): string {
  return categories.length > 0 ? categories.join(', ') : 'none';
}

function buildSkillReadmeSection(readme: string | null | undefined): string {
  const normalized = readme?.trim();
  if (!normalized) {
    return '';
  }

  return `
## Original SKILL.md

The original skill markdown follows unchanged below.

---

${normalized}
`;
}

export function isOpenClawUserAgent(userAgent: string | null | undefined): boolean {
  return OPENCLAW_UA_PATTERN.test((userAgent || '').trim());
}

export function buildOpenClawHomeMarkdown(): string {
  return `
# SkillsCat for OpenClaw

OpenClaw user agent detected. This response is markdown on purpose so the agent can learn the install flow without first discovering \`/llm.txt\`.

## Fast path

- Prefer the native SkillsCat CLI when terminal access is available.
- Install for OpenClaw with: \`npx skillscat add <owner>/<repo> --agent openclaw\`
- For one skill inside a multi-skill repo: \`npx skillscat add <owner>/<repo> --skill "<skill-name>" --agent openclaw\`
- Canonical machine guide: \`https://skills.cat/llm.txt\`
- If manual installation is required, fetch \`/api/skills/<slug>/files\` and write the returned files into \`<workspace>/skills/<folderName>/\` or \`~/.openclaw/skills/<folderName>/\`
- Preserve every returned relative path exactly, including companion files next to \`SKILL.md\`
- Start a new OpenClaw session after installation

## Canonical machine guide

${buildLlmTxt()}
`.trim();
}

export function buildOpenClawSkillMarkdown(skill: SkillDetail): string {
  const skillPath = `${SITE_URL}${buildSkillPath(skill.slug)}`;
  const registryPath = `${SITE_URL}/registry/skill/${encodeSkillSlugForPath(skill.slug)}`;
  const skillFilesUrl = `${SITE_URL}/api/skills/${encodeURIComponent(skill.slug)}/files`;
  const skillFileUrl = `${SITE_URL}/api/skills/${encodeURIComponent(skill.slug)}/file?path=SKILL.md`;
  const installCommand = buildOpenClawInstallCommand(skill);
  const folderName = buildFolderName(skill.name);
  const repoLabel = skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : 'not linked';
  const visibilityNote = skill.visibility === 'private'
    ? '- private skill: run `npx skillscat login` first, then install with the command below'
    : skill.visibility === 'unlisted'
      ? '- unlisted skill: keep the exact URL and slug; avoid assuming it is discoverable from public search'
      : '- public skill: anonymous reads are allowed, but `/api/skills/<slug>/files` remains the canonical install source';

  return `
# ${skill.name}

OpenClaw user agent detected. This skill page is intentionally returned as markdown so the agent can install or inspect the skill without scraping HTML.

## Skill Summary

- slug: \`${skill.slug}\`
- description: ${skill.description?.trim() || 'No description provided.'}
- repo: \`${repoLabel}\`
- source: ${skill.sourceType}
- visibility: ${skill.visibility}
- categories: ${formatCategories(skill.categories)}
- web page: ${skillPath}

## Install for OpenClaw

- preferred CLI command: \`${installCommand}\`
${visibilityNote}
- manual bundle endpoint: \`${skillFilesUrl}\`
- single-file endpoint: \`${skillFileUrl}\`
- lightweight registry view: \`${registryPath}\`
- target directory (project-local): \`<workspace>/skills/${folderName}/\`
- target directory (global): \`~/.openclaw/skills/${folderName}/\`
- write every file from \`/api/skills/<slug>/files\` into the target directory without flattening nested paths
- keep SKILL.md frontmatter unchanged
- start a new OpenClaw session after installation

## Related Docs

- OpenClaw guide: ${SITE_URL}/docs/openclaw
- SkillsCat machine guide: ${SITE_URL}/llm.txt

${buildSkillReadmeSection(skill.readme)}
`.trim();
}
