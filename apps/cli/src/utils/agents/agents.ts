import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface Agent {
  id: string;
  name: string;
  projectPath: string;
  globalPath: string;
}

function sanitizeSkillDirName(skillName: string): string {
  const sanitized = skillName
    .replace(/[\\/]/g, '-')
    .replace(/[<>:"|?*]/g, '-')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return 'skill';
  }

  return sanitized;
}

export const AGENTS: Agent[] = [
  {
    id: 'amp',
    name: 'Amp',
    projectPath: '.agents/skills/',
    globalPath: join(homedir(), '.config', 'agents', 'skills')
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    projectPath: '.agent/skills/',
    globalPath: join(homedir(), '.gemini', 'antigravity', 'skills')
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    projectPath: '.claude/skills/',
    globalPath: join(homedir(), '.claude', 'skills')
  },
  {
    id: 'clawdbot',
    name: 'Clawdbot',
    projectPath: 'skills/',
    globalPath: join(homedir(), '.clawdbot', 'skills')
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    projectPath: '.codebuddy/skills/',
    globalPath: join(homedir(), '.codebuddy', 'skills')
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
    id: 'droid',
    name: 'Droid',
    projectPath: '.factory/skills/',
    globalPath: join(homedir(), '.factory', 'skills')
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    projectPath: '.gemini/skills/',
    globalPath: join(homedir(), '.gemini', 'skills')
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    projectPath: '.github/skills/',
    globalPath: join(homedir(), '.copilot', 'skills')
  },
  {
    id: 'goose',
    name: 'Goose',
    projectPath: '.goose/skills/',
    globalPath: join(homedir(), '.config', 'goose', 'skills')
  },
  {
    id: 'kilo-code',
    name: 'Kilo Code',
    projectPath: '.kilocode/skills/',
    globalPath: join(homedir(), '.kilocode', 'skills')
  },
  {
    id: 'kiro-cli',
    name: 'Kiro CLI',
    projectPath: '.kiro/skills/',
    globalPath: join(homedir(), '.kiro', 'skills')
  },
  {
    id: 'neovate',
    name: 'Neovate',
    projectPath: '.neovate/skills/',
    globalPath: join(homedir(), '.neovate', 'skills')
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    projectPath: '.opencode/skill/',
    globalPath: join(homedir(), '.config', 'opencode', 'skill')
  },
  {
    id: 'qoder',
    name: 'Qoder',
    projectPath: '.qoder/skills/',
    globalPath: join(homedir(), '.qoder', 'skills')
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    projectPath: '.roo/skills/',
    globalPath: join(homedir(), '.roo', 'skills')
  },
  {
    id: 'trae',
    name: 'Trae',
    projectPath: '.trae/skills/',
    globalPath: join(homedir(), '.trae', 'skills')
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
  return join(basePath, sanitizeSkillDirName(skillName));
}
