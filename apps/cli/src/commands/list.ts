import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { AGENTS, getAgentsByIds, getInvalidAgentIds, type Agent } from '../utils/agents/agents';
import { getInstalledSkills } from '../utils/storage/db';
import { parseSkillFrontmatter } from '../utils/source/source';
import { dataTable, error, hint, warn } from '../utils/core/ui';

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
    const invalidAgentIds = getInvalidAgentIds(options.agent);
    if (invalidAgentIds.length > 0) {
      error(`Invalid agent(s): ${invalidAgentIds.join(', ')}`);
      process.exit(1);
    }
    agents = getAgentsByIds(options.agent);
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
    hint('Install skills with:', 'npx skillscat add <slug>');
    console.log();
    hint('Or search for skills:', 'npx skillscat search <query>');
    return;
  }

  dataTable(`Installed skills (${skills.length}):`, ['#', 'Skill', 'Agent', 'Location', 'Description'],
    skills.map((skill, i) => [String(i + 1), skill.name, skill.agent, skill.location, skill.description || '(none)']));

  // Show tracked skills from database
  const dbSkills = getInstalledSkills();
  if (dbSkills.length > 0) {
    console.log(pc.dim(`Tracked installations: ${dbSkills.length}`));
    hint('Check for updates:', 'npx skillscat update --check');
  }
}
