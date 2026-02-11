import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { AGENTS, getAgentsByIds, getSkillPath, type Agent } from '../utils/agents/agents';
import { getInstalledSkills, recordInstallation, type InstalledSkill } from '../utils/storage/db';
import { fetchSkill as fetchGitSkill } from '../utils/source/git';
import { fetchSkill as fetchRegistrySkill } from '../utils/api/registry';
import { success, error, warn, info, spinner } from '../utils/core/ui';
import { cacheSkill, calculateContentHash } from '../utils/storage/cache';
import { verboseLog } from '../utils/core/verbose';

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
    agents = getAgentsByIds(options.agent);
    if (agents.length === 0) {
      error(`Invalid agent(s): ${options.agent.join(', ')}`);
      process.exit(1);
    }
  } else {
    agents = AGENTS;
  }

  console.log();
  info(`Checking ${skillsToCheck.length} skill(s) for updates...`);
  console.log();

  const updates: {
    skill: InstalledSkill;
    newContent: string;
    newSha?: string;
    newContentHash: string;
    cacheOwner?: string;
    cacheRepo?: string;
    cacheSource: 'github' | 'registry';
  }[] = [];

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
          continue;
        }

        const latestSkill = await fetchRegistrySkill(slug);
        if (!latestSkill || !latestSkill.content) {
          checkSpinner.stop(false);
          warn(`${skill.name}: Skill no longer exists in registry`);
          continue;
        }

        const latestHash = latestSkill.contentHash || calculateContentHash(latestSkill.content);
        const hasUpdate = skill.contentHash ? latestHash !== skill.contentHash : true;

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
        continue;
      }

      const latestSkill = await fetchGitSkill(skill.source, skill.name);

      if (!latestSkill) {
        checkSpinner.stop(false);
        warn(`${skill.name}: Skill no longer exists in source repository`);
        continue;
      }

      // Compare by contentHash first, then by SHA
      const latestHash = latestSkill.contentHash || calculateContentHash(latestSkill.content);
      const hasUpdate = skill.contentHash
        ? latestHash !== skill.contentHash
        : (latestSkill.sha && skill.sha ? latestSkill.sha !== skill.sha : true);

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
        cacheOwner: skill.source.owner,
        cacheRepo: skill.source.repo,
        cacheSource: 'github',
      });

      console.log(`  ${pc.yellow('⬆')} ${skill.name}: Update available`);
    } catch (err) {
      checkSpinner.stop(false);
      console.log(pc.dim(`  ${skill.name}: Failed to check (${err instanceof Error ? err.message : 'Unknown error'})`));
    }
  }

  console.log();

  if (updates.length === 0) {
    success('All skills are up to date!');
    return;
  }

  // Check only mode
  if (options.check) {
    info(`${updates.length} skill(s) have updates available.`);
    console.log(pc.dim('Run `npx skillscat update` to install updates.'));
    return;
  }

  // Install updates
  info(`Installing ${updates.length} update(s)...`);
  console.log();

  let updated = 0;

  for (const { skill, newContent, newSha, newContentHash, cacheOwner, cacheRepo, cacheSource } of updates) {
    const skillAgents = skill.agents
      .map(id => agents.find(a => a.id === id))
      .filter((a): a is Agent => a !== undefined);

    if (skillAgents.length === 0) {
      skillAgents.push(...agents.filter(a => skill.agents.includes(a.id)));
    }

    for (const agent of skillAgents) {
      const skillDir = getSkillPath(agent, skill.name, skill.global);
      const skillFile = join(skillDir, 'SKILL.md');

      try {
        mkdirSync(dirname(skillFile), { recursive: true });
        writeFileSync(skillFile, newContent, 'utf-8');
        updated++;

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
      }
    }

    // Update database record
    recordInstallation({
      ...skill,
      sha: newSha,
      contentHash: newContentHash,
      installedAt: Date.now()
    });
  }

  console.log();
  success(`Updated ${updated} skill(s) successfully!`);
}
