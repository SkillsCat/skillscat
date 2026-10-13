import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { AGENTS, detectPreferredAgents, getAgentById, getAgentsByIds, getInvalidAgentIds, getSkillPath } from '../utils/agents/agents';
import { getValidToken, isAuthenticated } from '../utils/auth/auth';
import { cancelled, dataTable, error, hint, info, success, terminalText, warn, PromptCancelledError } from '../utils/core/ui';
import { confirm, selectMany } from '../utils/core/prompts';
import { discoverLocalSkills, loadLocalSkill, type LocalSkill } from '../utils/source/local';
import { getInstalledSkills, recordInstallation } from '../utils/storage/db';
import { assertSkillFilesSafe, companionFilesAreUpToDate, writeLocalSkillBundle } from '../utils/storage/skill-files';
import type { AddOptions } from './add';
import { publish } from './publish';

function displayText(value: string): string {
  return terminalText(value).replace(/\s+/g, ' ').trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function directoryIdentity(path: string): string | null {
  const stat = lstatSync(path, { throwIfNoEntry: false, bigint: true });
  return stat?.isDirectory() && stat.ino !== 0n ? `${stat.dev}:${stat.ino}` : null;
}

export async function installLocal(source: string, options: AddOptions): Promise<void> {
  if (options.repo) throw new Error('--repo cannot be used with a local directory.');
  const requestedRoot = resolve(source);
  const excludeDirectories = getInstalledSkills({ reconcile: false }).flatMap((skill) => skill.agents.flatMap((id) => {
    const agent = getAgentById(id);
    if (!agent) return [];
    const directory = getSkillPath(agent, skill.name, skill.global, skill.installRoot);
    return directory !== requestedRoot && directory !== skill.localPath ? [directory] : [];
  }));
  const { root, skills, warnings } = discoverLocalSkills(requestedRoot, { excludeDirectories });
  for (const message of warnings) warn(displayText(message));
  if (!skills.length) throw new Error('No installable skills found. Each SKILL.md needs name and description frontmatter.');

  dataTable(`Found ${skills.length} local skill(s):`, ['#', 'Skill', 'Path', 'Description'], skills.map((skill, i) => [
    String(i + 1), displayText(skill.name), displayText(relative(root, skill.directory) || '.'), displayText(skill.description),
  ]));
  if (options.list) return;

  let selected = skills;
  if (options.skill?.length) {
    const chosen = new Set<string>();
    const missing: string[] = [];
    for (const name of options.skill) {
      const requestedPath = name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.';
      const pathMatches = skills.filter((skill) => {
        const path = relative(root, skill.directory).split(sep).join('/') || '.';
        return process.platform === 'win32' ? path.toLowerCase() === requestedPath.toLowerCase() : path === requestedPath;
      });
      const matches = pathMatches.length ? pathMatches : skills.filter((skill) => skill.name.toLowerCase() === name.toLowerCase());
      if (!matches.length) missing.push(name);
      for (const skill of matches) chosen.add(skill.directory);
    }
    if (missing.length) throw new Error(`No local skills found matching: ${missing.join(', ')}`);
    selected = skills.filter((skill) => chosen.has(skill.directory));
  } else if (!options.yes) {
    const answer = await selectMany({
      name: 'skills', message: 'Choose skills to install',
      choices: skills.map((skill, i) => ({ name: `${i + 1}. ${displayText(skill.name)} (${displayText(relative(root, skill.directory) || '.')})`, value: skill.directory })),
    });
    selected = skills.filter((skill) => answer.includes(skill.directory));
  }
  if (!selected.length) { cancelled('Installation cancelled.'); return; }

  const global = options.global === true || Boolean(options.globalAgent?.length);
  const ids = [...(options.agent ?? []), ...(options.globalAgent ?? [])];
  const invalid = getInvalidAgentIds(ids);
  if (invalid.length) throw new Error(`Invalid agent(s): ${invalid.join(', ')}`);
  let agents = ids.length ? getAgentsByIds(ids) : detectPreferredAgents(global);
  if (!ids.length && !options.yes) {
    const preferred = new Set(agents.map((agent) => agent.id));
    const answer = await selectMany({
      name: 'agents', message: 'Choose agents to install to',
      choices: AGENTS.map((agent) => ({ name: `${agent.name} (${agent.id})`, value: agent.id, checked: preferred.has(agent.id) })),
    });
    agents = getAgentsByIds(answer);
  }
  if (!agents.length) { cancelled('Installation cancelled.'); return; }

  // Read every selected bundle and validate collisions before changing any target.
  let selectedBytes = 0;
  const bundles = selected.map((skill) => {
    const bundle = loadLocalSkill(skill.directory);
    selectedBytes += Buffer.byteLength(bundle.content)
      + (bundle.companionFiles ?? []).reduce((total, file) => total + file.content.byteLength, 0);
    if (selectedBytes > 256 * 1024 * 1024) throw new Error('Selected local bundles exceed 256 MiB. Install fewer skills at once.');
    return bundle;
  });
  const sourceKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  const selectedSources = new Set(bundles.map((skill) => sourceKey(skill.directory)));
  const sourceIdentities = new Map(bundles.map((skill) => [skill.directory, directoryIdentity(skill.directory)]));
  const selectedIdentities = new Set([...sourceIdentities.values()].filter((id): id is string => id !== null));
  const sourceParents = new Set<string>();
  const sourceParentIdentities = new Set<string>();
  for (const skill of skills) {
    let parent = dirname(skill.directory);
    while (parent !== dirname(parent) && !sourceParents.has(sourceKey(parent))) {
      sourceParents.add(sourceKey(parent));
      const id = directoryIdentity(parent);
      if (id) sourceParentIdentities.add(id);
      parent = dirname(parent);
    }
  }
  const destinations = new Map<string, string>();
  for (const skill of bundles) {
    for (const agent of agents) {
      const directory = getSkillPath(agent, skill.name, global);
      const identity = directoryIdentity(directory);
      const isSource = directory === skill.directory || (identity !== null && identity === sourceIdentities.get(skill.directory));
      const key = directory.toLowerCase();
      if (destinations.has(key) && destinations.get(key) !== skill.directory) {
        throw new Error(`Multiple skills resolve to the same installation directory: ${displayText(skill.name)}. Select one using --skill <path>.`);
      }
      destinations.set(key, skill.directory);
      if (!isSource && (selectedSources.has(sourceKey(directory)) || sourceParents.has(sourceKey(directory))
        || (identity !== null && (selectedIdentities.has(identity) || sourceParentIdentities.has(identity))))) {
        throw new Error(`Installation would overwrite a source skill: ${directory}`);
      }
      assertSkillFilesSafe(directory, skill);
    }
  }
  for (const path of destinations.keys()) {
    let parent = dirname(path);
    while (parent !== dirname(parent)) {
      if (destinations.has(parent)) {
        throw new Error('Selected agent installation destinations overlap. Install to these agents separately.');
      }
      parent = dirname(parent);
    }
  }
  dataTable(`Installing ${bundles.length} skill(s) to ${agents.length} agent(s) (${global ? 'global' : 'project'}):`,
    ['#', 'Skill', 'Source'], bundles.map((skill, i) => [String(i + 1), skill.name, relative(root, skill.directory) || '.']));
  dataTable('Target agents:', ['Agent', 'Destination'], agents.map((agent) => [agent.name, global ? agent.globalPath : join(process.cwd(), agent.projectPath)]));
  if (!options.yes) {
    if (!await confirm('Install selected skills?', true)) { cancelled('Installation cancelled.'); return; }
  }

  let installed = 0;
  let skipped = 0;
  let failures = 0;
  const available: LocalSkill[] = [];
  for (const skill of bundles) {
    const activeAgents: string[] = [];
    try {
      for (const agent of agents) {
        const directory = getSkillPath(agent, skill.name, global);
        const file = join(directory, 'SKILL.md');
        try {
          assertSkillFilesSafe(directory, skill);
          const identity = directoryIdentity(directory);
          if (directory === skill.directory || (identity !== null && identity === sourceIdentities.get(skill.directory))) { skipped++; continue; }
          if (existsSync(file) && readFileSync(file, 'utf-8') === skill.content && companionFilesAreUpToDate(directory, skill)) {
            skipped++;
            activeAgents.push(agent.id);
            continue;
          }
          if (existsSync(file) && !options.force) {
            if (options.yes) { warn(`${displayText(skill.name)} exists for ${agent.name}; use --force to overwrite.`); skipped++; continue; }
            if (!await confirm(`Overwrite ${displayText(skill.name)} for ${agent.name}?`)) { skipped++; continue; }
          }
          writeLocalSkillBundle(directory, skill);
          activeAgents.push(agent.id);
          installed++;
        } catch (err) {
          if (err instanceof PromptCancelledError) throw err;
          error(`Failed to install ${displayText(skill.name)} for ${agent.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          failures++;
        }
      }
    } finally {
      if (activeAgents.length) {
        recordInstallation({ name: skill.name, description: skill.description, agents: activeAgents, global,
          installedAt: Date.now(), path: skill.path, localPath: skill.directory, updateStrategy: 'local',
          contentHash: skill.contentHash, installRoot: global ? undefined : process.cwd() });
        available.push(skill);
      }
    }
  }
  if (installed) success(`Installed ${installed} agent installation(s).`);
  if (skipped) info(`Skipped ${skipped} agent installation(s).`);
  if (failures) { process.exitCode = 1; warn(`${failures} agent installation(s) failed.`); }
  if (available.length) {
    info('Restart your agent or start a new session to use these skills.');
    await guidePublishing(available, options.yes === true);
  }
}

async function guidePublishing(skills: LocalSkill[], nonInteractive: boolean): Promise<void> {
  if (!isAuthenticated()) return;
  if (nonInteractive) {
    for (const skill of skills) hint('Submit a local skill to SkillsCat:', `npx skillscat publish ${shellQuote(skill.directory)}`);
    return;
  }
  if (!await confirm('Submit installed skills to SkillsCat? This opens a publishing preview.')) return;
  if (!await getValidToken()) { warn('Session expired. Run `skillscat login` before publishing.'); return; }
  const selection = await selectMany({
    name: 'skills', message: 'Choose skills to publish to SkillsCat',
    choices: skills.map((skill) => ({ name: `${displayText(skill.name)} (${displayText(skill.directory)})`, value: skill.directory })),
  });
  for (const skill of skills) {
    if (!selection.includes(skill.directory)) continue;
    try {
      await publish(skill.directory, { throwOnError: true, bundle: skill });
    } catch (err) {
      if (err instanceof PromptCancelledError) throw err;
      warn(`${displayText(skill.name)} could not be published: ${err instanceof Error ? err.message : 'Unknown error'}`);
      process.exitCode = 1;
    }
  }
}
