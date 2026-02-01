import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { AGENTS, getAgentsByIds, getSkillPath, type Agent } from '../utils/agents.js';
import { removeInstallation, getInstalledSkill } from '../utils/db.js';
import { success, error, warn, prompt } from '../utils/ui.js';

interface RemoveOptions {
  global?: boolean;
  agent?: string[];
}

export async function remove(skillName: string, options: RemoveOptions): Promise<void> {
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

  const isGlobal = options.global ?? false;
  let removed = 0;
  let notFound = 0;

  for (const agent of agents) {
    const skillDir = getSkillPath(agent, skillName, isGlobal);

    if (!existsSync(skillDir)) {
      notFound++;
      continue;
    }

    try {
      rmSync(skillDir, { recursive: true });
      removed++;
      success(`Removed ${skillName} from ${agent.name}`);
    } catch (err) {
      error(`Failed to remove from ${agent.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // Remove from database
  removeInstallation(skillName);

  if (removed === 0) {
    if (notFound === agents.length) {
      warn(`Skill "${skillName}" not found.`);

      // Check if it exists in the other location
      const otherLocation = !isGlobal;
      for (const agent of agents) {
        const otherDir = getSkillPath(agent, skillName, otherLocation);
        if (existsSync(otherDir)) {
          console.log(pc.dim(`Found in ${otherLocation ? 'global' : 'project'} directory.`));
          console.log(pc.dim(`Use ${otherLocation ? '--global' : ''} flag to remove.`));
          break;
        }
      }
    }
  } else {
    console.log();
    success(`Removed ${skillName} from ${removed} agent(s).`);
  }
}
