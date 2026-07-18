import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { AGENTS, getAgentsByIds, getInvalidAgentIds, getSkillPath, type Agent } from '../utils/agents/agents';
import { getInstalledSkills, recordInstallation, type InstalledSkill } from '../utils/storage/db';
import { fetchSkill as fetchGitSkill, fetchSkillCompanionFilesWithOptions } from '../utils/source/git';
import {
  fetchSkill as fetchRegistrySkill,
  fetchSkillFiles,
  RegistryRequestError,
} from '../utils/api/registry';
import { companionFilesAreUpToDate, syncCompanionFiles } from './add';
import { success, error, warn, info, spinner } from '../utils/core/ui';
import { cacheSkill, calculateContentHash } from '../utils/storage/cache';
import { verboseLog } from '../utils/core/verbose';
import type { SkillCompanionFile, SkillInfo } from '../utils/source/source';

interface UpdateOptions {
  agent?: string[];
  check?: boolean;
}

function getUpdateStrategy(skill: InstalledSkill): 'git' | 'registry' {
  if (skill.updateStrategy === 'registry') return 'registry';
  if (skill.updateStrategy === 'git') return 'git';
  return skill.registrySlug ? 'registry' : 'git';
}

function getRegistrySlug(skill: InstalledSkill): string | null {
  if (skill.registrySlug && skill.registrySlug.includes('/')) {
    return skill.registrySlug;
  }
  if (skill.source?.owner && skill.source?.repo) {
    return `${skill.source.owner}/${skill.source.repo}`;
  }
  return null;
}

async function fetchRegistryCompanionFiles(slug: string): Promise<SkillCompanionFile[] | null> {
  const bundle = await fetchSkillFiles(slug);
  if (!bundle) return null;

  return bundle.files
    .filter((file) => file.path.toLowerCase() !== 'skill.md')
    .map((file) => ({
      path: file.path,
      content: Buffer.from(file.content, 'utf-8'),
    }));
}

async function fetchUpdatedCompanionFiles(
  strategy: 'git' | 'registry',
  skill: InstalledSkill,
  skillPath: string,
  registrySlug?: string
): Promise<{ files: SkillCompanionFile[] | null; failed: boolean }> {
  try {
    if (strategy === 'registry') {
      if (!registrySlug) return { files: null, failed: true };
      return { files: await fetchRegistryCompanionFiles(registrySlug), failed: false };
    }

    if (!skill.source) return { files: null, failed: true };
    return {
      files: await fetchSkillCompanionFilesWithOptions(skill.source, skillPath),
      failed: false,
    };
  } catch (err) {
    if (
      strategy === 'registry'
      && err instanceof RegistryRequestError
      && (err.status === 401 || err.status === 403)
    ) {
      throw err;
    }
    verboseLog(`Failed to refresh companion files for ${skill.name}: ${err instanceof Error ? err.message : 'unknown'}`);
    return { files: null, failed: true };
  }
}

function hasCompanionFileChanges(
  skill: InstalledSkill,
  content: string,
  files: SkillCompanionFile[] | null,
  hydrationFailed: boolean,
  agents: Agent[]
): boolean {
  if (hydrationFailed || files === null) return false;

  const candidate: SkillInfo = {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    content,
    companionFiles: files,
  };

  return skill.agents
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => agent !== undefined)
    .some((agent) => {
      const skillDir = getSkillPath(agent, skill.name, skill.global, skill.installRoot);
      return !companionFilesAreUpToDate(skillDir, candidate);
    });
}

function hasSelectedAgentContentChanges(
  skill: InstalledSkill,
  latestContent: string,
  agents: Agent[]
): boolean {
  const latestLocalHash = calculateContentHash(latestContent);

  return skill.agents
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => agent !== undefined)
    .some((agent) => {
      const skillFile = join(
        getSkillPath(agent, skill.name, skill.global, skill.installRoot),
        'SKILL.md'
      );
      try {
        return calculateContentHash(readFileSync(skillFile, 'utf-8')) !== latestLocalHash;
      } catch {
        return true;
      }
    });
}

export async function update(skillName: string | undefined, options: UpdateOptions): Promise<void> {
  const installedSkills = getInstalledSkills();

  if (installedSkills.length === 0) {
    warn('No tracked skill installations found.');
    console.log(pc.dim('Install skills with `npx skillscat add <source>` to track them.'));
    return;
  }

  // Filter by skill name if provided
  let skillsToCheck = installedSkills;
  if (skillName) {
    skillsToCheck = installedSkills.filter(s =>
      s.name.toLowerCase() === skillName.toLowerCase()
    );

    if (skillsToCheck.length === 0) {
      error(`Skill "${skillName}" not found in tracked installations.`);
      console.log(pc.dim('Available tracked skills:'));
      for (const skill of installedSkills) {
        console.log(pc.dim(`  - ${skill.name}`));
      }
      process.exit(1);
    }
  }

  // Determine which agents to update
  let agents: Agent[];
  if (options.agent && options.agent.length > 0) {
    const invalidAgentIds = getInvalidAgentIds(options.agent);
    if (invalidAgentIds.length > 0) {
      error(`Invalid agent(s): ${invalidAgentIds.join(', ')}`);
      process.exit(1);
    }
    agents = getAgentsByIds(options.agent);
  } else {
    agents = AGENTS;
  }

  if (options.agent && options.agent.length > 0) {
    const selectedAgentIds = new Set(agents.map((agent) => agent.id));
    skillsToCheck = skillsToCheck.filter((skill) =>
      skill.agents.some((agentId) => selectedAgentIds.has(agentId))
    );
    if (skillsToCheck.length === 0) {
      warn('No tracked skill installations match the selected agent(s).');
      return;
    }
  }

  console.log();
  info(`Checking ${skillsToCheck.length} skill(s) for updates...`);
  console.log();

  const updates: {
    skill: InstalledSkill;
    newContent: string;
    newSha?: string;
    newContentHash: string;
    companionFiles?: SkillCompanionFile[] | null;
    companionFilesHydrationFailed: boolean;
    cacheOwner?: string;
    cacheRepo?: string;
    cacheSource: 'github' | 'registry';
  }[] = [];
  let checkFailures = 0;

  // Check each skill for updates
  for (const skill of skillsToCheck) {
    const checkSpinner = spinner(`Checking ${skill.name}`);

    try {
      const strategy = getUpdateStrategy(skill);

      if (strategy === 'registry') {
        const slug = getRegistrySlug(skill);
        if (!slug) {
          checkSpinner.stop(false);
          warn(`${skill.name}: Missing registry slug; cannot check updates`);
          checkFailures += 1;
          continue;
        }

        const latestSkill = await fetchRegistrySkill(slug);
        if (!latestSkill || !latestSkill.content) {
          checkSpinner.stop(false);
          warn(`${skill.name}: Skill no longer exists in registry`);
          checkFailures += 1;
          continue;
        }

        const latestHash = latestSkill.contentHash || calculateContentHash(latestSkill.content);
        const companionResult = await fetchUpdatedCompanionFiles('registry', skill, skill.path, slug);
        const hasContentUpdate = options.agent && options.agent.length > 0
          ? hasSelectedAgentContentChanges(skill, latestSkill.content, agents)
          : (skill.contentHash ? latestHash !== skill.contentHash : true);
        const hasUpdate = hasContentUpdate
          || hasCompanionFileChanges(
            skill,
            latestSkill.content,
            companionResult.files,
            companionResult.failed,
            agents
          );

        if (!hasUpdate) {
          checkSpinner.stop(true);
          console.log(pc.dim(`  ${skill.name}: Up to date`));
          continue;
        }

        checkSpinner.stop(true);
        updates.push({
          skill,
          newContent: latestSkill.content,
          newContentHash: latestHash,
          companionFiles: companionResult.files,
          companionFilesHydrationFailed: companionResult.failed,
          cacheOwner: skill.source?.owner || latestSkill.owner,
          cacheRepo: skill.source?.repo || latestSkill.repo,
          cacheSource: 'registry',
        });
        console.log(`  ${pc.yellow('⬆')} ${skill.name}: Update available`);
        continue;
      }

      if (!skill.source) {
        checkSpinner.stop(false);
        warn(`${skill.name}: Missing source repository; cannot check updates`);
        checkFailures += 1;
        continue;
      }

      const latestSkill = await fetchGitSkill(skill.source, skill.name);

      if (!latestSkill) {
        checkSpinner.stop(false);
        warn(`${skill.name}: Skill no longer exists in source repository`);
        checkFailures += 1;
        continue;
      }

      // Compare by contentHash first, then by SHA
      const latestHash = latestSkill.contentHash || calculateContentHash(latestSkill.content);
      const companionResult = await fetchUpdatedCompanionFiles('git', skill, skill.path);
      const hasContentUpdate = options.agent && options.agent.length > 0
        ? hasSelectedAgentContentChanges(skill, latestSkill.content, agents)
        : skill.contentHash
          ? latestHash !== skill.contentHash
          : (latestSkill.sha && skill.sha ? latestSkill.sha !== skill.sha : true);
      const hasUpdate = hasContentUpdate || hasCompanionFileChanges(
        skill,
        latestSkill.content,
        companionResult.files,
        companionResult.failed,
        agents
      );

      if (!hasUpdate) {
        checkSpinner.stop(true);
        console.log(pc.dim(`  ${skill.name}: Up to date`));
        continue;
      }

      checkSpinner.stop(true);
      updates.push({
        skill,
        newContent: latestSkill.content,
        newSha: latestSkill.sha,
        newContentHash: latestHash,
        companionFiles: companionResult.files,
        companionFilesHydrationFailed: companionResult.failed,
        cacheOwner: skill.source.owner,
        cacheRepo: skill.source.repo,
        cacheSource: 'github',
      });

      console.log(`  ${pc.yellow('⬆')} ${skill.name}: Update available`);
    } catch (err) {
      checkSpinner.stop(false);
      console.log(pc.dim(`  ${skill.name}: Failed to check (${err instanceof Error ? err.message : 'Unknown error'})`));
      checkFailures += 1;
    }
  }

  console.log();

  if (updates.length === 0) {
    if (checkFailures > 0) {
      warn(`${checkFailures} skill(s) could not be checked.`);
      process.exit(1);
    } else {
      success('All skills are up to date!');
    }
    return;
  }

  // Check only mode
  if (options.check) {
    info(`${updates.length} skill(s) have updates available.`);
    if (checkFailures > 0) {
      warn(`${checkFailures} additional skill(s) could not be checked.`);
    }
    console.log(pc.dim('Run `npx skillscat update` to install updates.'));
    if (checkFailures > 0) {
      process.exit(1);
    }
    return;
  }

  // Install updates
  info(`Installing ${updates.length} update(s)...`);
  console.log();

  let updatedSkills = 0;
  let writeFailures = 0;

  for (const {
    skill,
    newContent,
    newSha,
    newContentHash,
    companionFiles,
    companionFilesHydrationFailed,
    cacheOwner,
    cacheRepo,
    cacheSource,
  } of updates) {
    const skillAgents = skill.agents
      .map(id => agents.find(a => a.id === id))
      .filter((a): a is Agent => a !== undefined);

    if (skillAgents.length === 0) {
      skillAgents.push(...agents.filter(a => skill.agents.includes(a.id)));
    }

    let successfulWrites = 0;
    for (const agent of skillAgents) {
      const skillDir = getSkillPath(agent, skill.name, skill.global, skill.installRoot);
      const skillFile = join(skillDir, 'SKILL.md');

      try {
        mkdirSync(dirname(skillFile), { recursive: true });
        writeFileSync(skillFile, newContent, 'utf-8');
        if (!companionFilesHydrationFailed && companionFiles !== null && companionFiles !== undefined) {
          const updatedSkill: SkillInfo = {
            name: skill.name,
            description: skill.description,
            path: skill.path,
            content: newContent,
            companionFiles,
            sha: newSha,
            contentHash: newContentHash,
          };
          syncCompanionFiles(skillDir, updatedSkill);
        }
        successfulWrites++;

        // Cache the updated content
        if (cacheOwner && cacheRepo) {
          cacheSkill(
            cacheOwner,
            cacheRepo,
            newContent,
            cacheSource,
            skill.path !== 'SKILL.md' ? skill.path.replace(/\/SKILL\.md$/, '') : undefined,
            newSha
          );
          verboseLog(`Cached updated skill: ${skill.name}`);
        }
      } catch (err) {
        error(`Failed to update ${skill.name} for ${agent.name}`);
        writeFailures += 1;
      }
    }

    // Only advance the tracked hash when every tracked target was updated.
    // A partial write must remain retryable on the next invocation.
    const updatedAllTrackedAgents = skillAgents.length === skill.agents.length
      && successfulWrites === skillAgents.length
      && skillAgents.length > 0;
    if (updatedAllTrackedAgents) {
      recordInstallation({
        ...skill,
        sha: newSha,
        contentHash: newContentHash,
        installedAt: Date.now()
      });
    }
    if (successfulWrites > 0) {
      updatedSkills++;
    }
  }

  console.log();
  if (updatedSkills === 0) {
    error(`Failed to install ${updates.length} update(s).`);
    process.exit(1);
  }

  success(`Updated ${updatedSkills} skill(s) successfully!`);
  if (writeFailures > 0) {
    warn(`${writeFailures} agent installation(s) could not be updated.`);
  }
  if (checkFailures > 0) {
    warn(`${checkFailures} additional skill(s) could not be checked.`);
  }
  if (writeFailures > 0 || checkFailures > 0) {
    process.exit(1);
  }
}
