import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

export interface Agent {
  id: string;
  name: string;
  projectPath: string;
  globalPath: string;
}

export const AGENTS: Agent[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    projectPath: '.opencode/skill/',
    globalPath: join(homedir(), '.config', 'opencode', 'skill')
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    projectPath: '.claude/skills/',
    globalPath: join(homedir(), '.claude', 'skills')
  },
  {
    id: 'codex',
    name: 'Codex',
    projectPath: '.codex/skills/',
    globalPath: join(homedir(), '.codex', 'skills')
  },
  {
    id: 'cursor',
    name: 'Cursor',
    projectPath: '.cursor/skills/',
    globalPath: join(homedir(), '.cursor', 'skills')
  },
  {
    id: 'amp',
    name: 'Amp',
    projectPath: '.agents/skills/',
    globalPath: join(homedir(), '.config', 'agents', 'skills')
  },
  {
    id: 'kilo-code',
    name: 'Kilo Code',
    projectPath: '.kilocode/skills/',
    globalPath: join(homedir(), '.kilocode', 'skills')
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    projectPath: '.roo/skills/',
    globalPath: join(homedir(), '.roo', 'skills')
  },
  {
    id: 'goose',
    name: 'Goose',
    projectPath: '.goose/skills/',
    globalPath: join(homedir(), '.config', 'goose', 'skills')
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    projectPath: '.gemini/skills/',
    globalPath: join(homedir(), '.gemini', 'skills')
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    projectPath: '.agent/skills/',
    globalPath: join(homedir(), '.gemini', 'antigravity', 'skills')
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    projectPath: '.github/skills/',
    globalPath: join(homedir(), '.copilot', 'skills')
  },
  {
    id: 'clawdbot',
    name: 'Clawdbot',
    projectPath: 'skills/',
    globalPath: join(homedir(), '.clawdbot', 'skills')
  },
  {
    id: 'droid',
    name: 'Droid',
    projectPath: '.factory/skills/',
    globalPath: join(homedir(), '.factory', 'skills')
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    projectPath: '.windsurf/skills/',
    globalPath: join(homedir(), '.codeium', 'windsurf', 'skills')
  }
];

/**
 * Detect which agents are installed by checking for their config directories
 */
export function detectInstalledAgents(): Agent[] {
  return AGENTS.filter(agent => {
    // Check if global path exists (indicating agent is installed)
    const globalDir = agent.globalPath.replace(/\/skills\/?$/, '').replace(/\/skill\/?$/, '');
    return existsSync(globalDir);
  });
}

/**
 * Get agent by ID
 */
export function getAgentById(id: string): Agent | undefined {
  return AGENTS.find(a => a.id === id || a.id === id.toLowerCase().replace(/\s+/g, '-'));
}

/**
 * Get agents by IDs
 */
export function getAgentsByIds(ids: string[]): Agent[] {
  return ids.map(id => getAgentById(id)).filter((a): a is Agent => a !== undefined);
}

/**
 * Get skill installation path for an agent
 */
export function getSkillPath(agent: Agent, skillName: string, global: boolean): string {
  const basePath = global ? agent.globalPath : join(process.cwd(), agent.projectPath);
  return join(basePath, skillName);
}
