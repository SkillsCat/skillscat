import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { AGENTS, getAgentsByIds, getSkillPath, type Agent } from '../utils/agents.js';
import { getInstalledSkills, removeInstallation, type InstalledSkill } from '../utils/db.js';
import { parseSkillFrontmatter } from '../utils/source.js';
import { success, error, warn, info, table } from '../utils/ui.js';

interface ListOptions {
  global?: boolean;
  agent?: string[];
  all?: boolean;
}

interface FoundSkill {
  name: string;
  description: string;
  agent: string;
  location: 'project' | 'global';
  path: string;
}

function discoverLocalSkills(agents: Agent[], global: boolean): FoundSkill[] {
  const skills: FoundSkill[] = [];

  for (const agent of agents) {
    const basePath = global ? agent.globalPath : join(process.cwd(), agent.projectPath);

    if (!existsSync(basePath)) continue;

    try {
      const entries = readdirSync(basePath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFile = join(basePath, entry.name, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        try {
          const content = readFileSync(skillFile, 'utf-8');
          const metadata = parseSkillFrontmatter(content);

          skills.push({
            name: metadata?.name || entry.name,
            description: metadata?.description || '',
            agent: agent.name,
            location: global ? 'global' : 'project',
            path: join(basePath, entry.name)
          });
        } catch {
          // Skip invalid skill files
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return skills;
}

export async function list(options: ListOptions): Promise<void> {
  // Determine which agents to check
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

  const skills: FoundSkill[] = [];

  // Collect skills based on options
  if (options.all) {
    skills.push(...discoverLocalSkills(agents, false));
    skills.push(...discoverLocalSkills(agents, true));
  } else if (options.global) {
    skills.push(...discoverLocalSkills(agents, true));
  } else {
    // Default: show project skills
    skills.push(...discoverLocalSkills(agents, false));
  }

  if (skills.length === 0) {
    warn('No skills installed.');
    console.log();
    console.log(pc.dim('Install skills with:'));
    console.log(`  ${pc.cyan('npx skillscat add <owner>/<repo>')}`);
    console.log();
    console.log(pc.dim('Or search for skills:'));
    console.log(`  ${pc.cyan('npx skillscat search <query>')}`);
    return;
  }

  console.log();
  console.log(pc.bold(`Installed skills (${skills.length}):`));
  console.log();

  // Group by agent
  const byAgent = new Map<string, FoundSkill[]>();
  for (const skill of skills) {
    const key = `${skill.agent} (${skill.location})`;
    if (!byAgent.has(key)) {
      byAgent.set(key, []);
    }
    byAgent.get(key)!.push(skill);
  }

  for (const [agentKey, agentSkills] of byAgent) {
    console.log(pc.cyan(agentKey));
    for (const skill of agentSkills) {
      console.log(`  ${pc.green('•')} ${pc.bold(skill.name)}`);
      if (skill.description) {
        console.log(`    ${pc.dim(skill.description)}`);
      }
    }
    console.log();
  }

  // Show tracked skills from database
  const dbSkills = getInstalledSkills();
  if (dbSkills.length > 0) {
    console.log(pc.dim('─'.repeat(50)));
    console.log(pc.dim(`Tracked installations: ${dbSkills.length}`));
    console.log(pc.dim('Run `npx skillscat update --check` to check for updates.'));
  }
}
