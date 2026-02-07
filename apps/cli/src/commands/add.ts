import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { parseSource } from '../utils/source/source';
import { discoverSkills } from '../utils/source/git';
import { fetchSkill } from '../utils/api/registry';
import { AGENTS, detectInstalledAgents, getAgentsByIds, getSkillPath, type Agent } from '../utils/agents/agents';
import { recordInstallation } from '../utils/storage/db';
import { success, error, warn, info, spinner, prompt } from '../utils/core/ui';
import { cacheSkill, getCachedSkill } from '../utils/storage/cache';
import { verboseLog } from '../utils/core/verbose';
import type { SkillInfo } from '../utils/source/source';

interface AddOptions {
  global?: boolean;
  agent?: string[];
  skill?: string[];
  list?: boolean;
  yes?: boolean;
  force?: boolean;
}

export async function add(source: string, options: AddOptions): Promise<void> {
  // Parse source
  const repoSource = parseSource(source);
  if (!repoSource) {
    error('Invalid source. Supported formats:');
    console.log(pc.dim('  owner/repo'));
    console.log(pc.dim('  https://github.com/owner/repo'));
    console.log(pc.dim('  https://gitlab.com/owner/repo'));
    process.exit(1);
  }

  const sourceLabel = `${repoSource.owner}/${repoSource.repo}`;
  info(`Fetching skills from ${pc.cyan(sourceLabel)}...`);

  // Check cache first for each potential skill path
  const cached = getCachedSkill(repoSource.owner, repoSource.repo, repoSource.path);
  if (cached && !options.force) {
    verboseLog('Found cached skill content');
  }

  // Discover skills
  const discoverSpinner = spinner('Discovering skills');
  let skills: SkillInfo[];

  try {
    skills = await discoverSkills(repoSource);
  } catch (err) {
    // GitHub/GitLab discovery failed — try the registry as fallback
    verboseLog(`Git discovery failed: ${err instanceof Error ? err.message : 'unknown'}`);
    verboseLog('Trying registry fallback...');

    try {
      const registrySkill = await fetchSkill(source);
      if (registrySkill && registrySkill.content) {
        skills = [{
          name: registrySkill.name,
          description: registrySkill.description || '',
          path: 'SKILL.md',
          content: registrySkill.content,
        }];
      } else {
        discoverSpinner.stop(false);
        error(err instanceof Error ? err.message : 'Failed to discover skills');
        process.exit(1);
      }
    } catch {
      discoverSpinner.stop(false);
      error(err instanceof Error ? err.message : 'Failed to discover skills');
      process.exit(1);
    }
  }

  discoverSpinner.stop(true);

  if (skills.length === 0) {
    warn('No skills found in this repository.');
    console.log(pc.dim('Make sure the repository contains SKILL.md files with valid frontmatter.'));
    process.exit(1);
  }

  // List mode - just show skills and exit
  if (options.list) {
    console.log();
    console.log(pc.bold(`Found ${skills.length} skill(s):`));
    console.log();

    for (const skill of skills) {
      console.log(`  ${pc.cyan(skill.name)}`);
      console.log(`  ${pc.dim(skill.description)}`);
      console.log(`  ${pc.dim(`Path: ${skill.path}`)}`);
      console.log();
    }

    console.log(pc.dim('─'.repeat(50)));
    console.log(pc.dim('Install with:'));
    console.log(`  ${pc.cyan(`npx skillscat add ${source}`)}`);
    return;
  }

  // Filter skills by name if specified
  let selectedSkills = skills;
  if (options.skill && options.skill.length > 0) {
    selectedSkills = skills.filter(s =>
      options.skill!.some(name => s.name.toLowerCase() === name.toLowerCase())
    );

    if (selectedSkills.length === 0) {
      error(`No skills found matching: ${options.skill.join(', ')}`);
      console.log(pc.dim('Available skills:'));
      for (const skill of skills) {
        console.log(pc.dim(`  - ${skill.name}`));
      }
      process.exit(1);
    }
  }

  // Detect or select agents
  let targetAgents: Agent[];

  if (options.agent && options.agent.length > 0) {
    targetAgents = getAgentsByIds(options.agent);
    if (targetAgents.length === 0) {
      error(`Invalid agent(s): ${options.agent.join(', ')}`);
      console.log(pc.dim('Available agents:'));
      for (const agent of AGENTS) {
        console.log(pc.dim(`  - ${agent.id} (${agent.name})`));
      }
      process.exit(1);
    }
  } else {
    // Auto-detect installed agents
    targetAgents = detectInstalledAgents();

    if (targetAgents.length === 0) {
      // No agents detected, ask user
      if (!options.yes) {
        console.log();
        warn('No coding agents detected.');
        console.log(pc.dim('Select agents to install skills for:'));
        console.log();

        for (let i = 0; i < AGENTS.length; i++) {
          console.log(`  ${pc.dim(`${i + 1}.`)} ${AGENTS[i].name} (${AGENTS[i].id})`);
        }
        console.log();

        const response = await prompt('Enter agent numbers (comma-separated) or "all": ');
        if (response.toLowerCase() === 'all') {
          targetAgents = AGENTS;
        } else {
          const indices = response.split(',').map(s => parseInt(s.trim()) - 1);
          targetAgents = indices
            .filter(i => i >= 0 && i < AGENTS.length)
            .map(i => AGENTS[i]);
        }

        if (targetAgents.length === 0) {
          error('No agents selected.');
          process.exit(1);
        }
      } else {
        // Default to Claude Code in --yes mode
        targetAgents = AGENTS.filter(a => a.id === 'claude-code');
      }
    }
  }

  const isGlobal = options.global ?? false;
  const locationLabel = isGlobal ? 'global' : 'project';

  console.log();
  console.log(pc.bold(`Installing ${selectedSkills.length} skill(s) to ${targetAgents.length} agent(s):`));
  console.log();

  // Show what will be installed
  for (const skill of selectedSkills) {
    console.log(`  ${pc.green('•')} ${pc.bold(skill.name)}`);
    console.log(`    ${pc.dim(skill.description)}`);
  }
  console.log();

  console.log(pc.dim('Target agents:'));
  for (const agent of targetAgents) {
    const path = isGlobal ? agent.globalPath : join(process.cwd(), agent.projectPath);
    console.log(`  ${pc.cyan('•')} ${agent.name} → ${pc.dim(path)}`);
  }
  console.log();

  // Confirmation
  if (!options.yes) {
    const confirm = await prompt(`Install to ${locationLabel} directory? [Y/n] `);
    if (confirm.toLowerCase() === 'n') {
      info('Installation cancelled.');
      process.exit(0);
    }
  }

  // Install skills
  let installed = 0;
  let skipped = 0;

  for (const skill of selectedSkills) {
    for (const agent of targetAgents) {
      const skillDir = getSkillPath(agent, skill.name, isGlobal);
      const skillFile = join(skillDir, 'SKILL.md');

      // Check if already installed
      if (existsSync(skillFile) && !options.force) {
        const existingContent = readFileSync(skillFile, 'utf-8');
        if (existingContent === skill.content) {
          skipped++;
          continue;
        }

        if (!options.yes) {
          warn(`${skill.name} already exists for ${agent.name}`);
          const overwrite = await prompt('Overwrite? [y/N] ');
          if (overwrite.toLowerCase() !== 'y') {
            skipped++;
            continue;
          }
        }
      }

      // Create directory and write file
      try {
        mkdirSync(dirname(skillFile), { recursive: true });
        writeFileSync(skillFile, skill.content, 'utf-8');
        installed++;

        // Cache the skill content
        cacheSkill(
          repoSource.owner,
          repoSource.repo,
          skill.content,
          'github',
          skill.path !== 'SKILL.md' ? skill.path.replace(/\/SKILL\.md$/, '') : undefined,
          skill.sha
        );
        verboseLog(`Cached skill: ${skill.name}`);
      } catch (err) {
        error(`Failed to install ${skill.name} to ${agent.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Record installation
    recordInstallation({
      name: skill.name,
      description: skill.description,
      source: repoSource,
      agents: targetAgents.map(a => a.id),
      global: isGlobal,
      installedAt: Date.now(),
      sha: skill.sha,
      path: skill.path,
      contentHash: skill.contentHash
    });
  }

  console.log();

  if (installed > 0) {
    success(`Installed ${installed} skill(s) successfully!`);
  }

  if (skipped > 0) {
    info(`Skipped ${skipped} skill(s) (already up to date)`);
  }

  console.log();
  console.log(pc.dim('Skills are now available in your coding agents.'));
  console.log(pc.dim('Restart your agent or start a new session to use them.'));
}
