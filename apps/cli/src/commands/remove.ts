import { existsSync, rmSync } from 'node:fs';
import pc from 'picocolors';
import { AGENTS, getAgentsByIds, getInvalidAgentIds, getSkillPath, type Agent } from '../utils/agents/agents';
import { getInstalledSkills, removeInstallation } from '../utils/storage/db';
import { success, error, warn } from '../utils/core/ui';

interface RemoveOptions {
  global?: boolean;
  agent?: string[];
}

export async function remove(skillName: string, options: RemoveOptions): Promise<void> {
  // Reconcile tracked installs so manual deletions do not leave stale records behind.
  getInstalledSkills();

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

  const isGlobal = options.global ?? false;
  let removed = 0;
  let notFound = 0;
  let removeFailures = 0;
  const removedAgentIds: string[] = [];

  for (const agent of agents) {
    const skillDir = getSkillPath(agent, skillName, isGlobal);

    if (!existsSync(skillDir)) {
      notFound++;
      continue;
    }

    try {
      rmSync(skillDir, { recursive: true });
      removed++;
      removedAgentIds.push(agent.id);
      success(`Removed ${skillName} from ${agent.name}`);
    } catch (err) {
      error(`Failed to remove from ${agent.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      removeFailures += 1;
    }
  }

  if (removed > 0) {
    removeInstallation(skillName, {
      agents: removedAgentIds,
      global: isGlobal,
      installRoot: isGlobal ? undefined : process.cwd(),
    });
  }

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

  if (removeFailures > 0) {
    process.exit(1);
  }
}
