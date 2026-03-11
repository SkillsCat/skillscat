import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface Agent {
  id: string;
  name: string;
  projectPath: string;
  globalPath: string;
  aliases?: string[];
}

export const FALLBACK_AGENT_ID = 'agents';

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
    id: FALLBACK_AGENT_ID,
    name: '.agents',
    projectPath: '.agents/',
    globalPath: join(homedir(), '.agents'),
    aliases: ['.agents', 'generic']
  },
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
    id: 'openclaw',
    name: 'OpenClaw',
    projectPath: 'skills/',
    globalPath: join(homedir(), '.openclaw', 'skills')
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

function normalizeAgentId(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, '-');
}

function getGlobalDetectionPath(agent: Agent): string {
  const normalized = agent.globalPath.replace(/[\\/]+$/, '');
  const container = normalized.replace(/[\\/](?:skill|skills)$/i, '');
  return container || normalized;
}

export function getAgentBasePath(agent: Agent, global: boolean, cwd = process.cwd()): string {
  return global ? agent.globalPath : join(cwd, agent.projectPath);
}

/**
 * Detect which agents are installed by checking for their config directories
 */
export function detectInstalledAgents(): Agent[] {
  return AGENTS.filter(agent => {
    const globalDir = getGlobalDetectionPath(agent);
    return existsSync(agent.globalPath) || existsSync(globalDir);
  });
}

export function detectProjectAgents(cwd = process.cwd()): Agent[] {
  return AGENTS.filter((agent) => existsSync(getAgentBasePath(agent, false, cwd)));
}

function preferSpecificAgents(agents: Agent[]): Agent[] {
  const specificAgents = agents.filter((agent) => agent.id !== FALLBACK_AGENT_ID);
  return specificAgents.length > 0 ? specificAgents : agents;
}

export function detectPreferredAgents(global: boolean, cwd = process.cwd()): Agent[] {
  if (global) {
    const installedAgents = preferSpecificAgents(detectInstalledAgents());
    return installedAgents.length > 0 ? installedAgents : [getFallbackAgent()];
  }

  const projectAgents = preferSpecificAgents(detectProjectAgents(cwd));
  if (projectAgents.length > 0) {
    return projectAgents;
  }

  const installedAgents = preferSpecificAgents(detectInstalledAgents());
  return installedAgents.length > 0 ? installedAgents : [getFallbackAgent()];
}

/**
 * Get agent by ID
 */
export function getAgentById(id: string): Agent | undefined {
  const normalized = normalizeAgentId(id);
  return AGENTS.find((agent) =>
    agent.id === normalized || agent.aliases?.some((alias) => normalizeAgentId(alias) === normalized)
  );
}

/**
 * Get agents by IDs
 */
export function getAgentsByIds(ids: string[]): Agent[] {
  return ids.map(id => getAgentById(id)).filter((a): a is Agent => a !== undefined);
}

export function getFallbackAgent(): Agent {
  const fallbackAgent = getAgentById(FALLBACK_AGENT_ID);
  if (!fallbackAgent) {
    throw new Error('Fallback .agents target is not configured');
  }
  return fallbackAgent;
}

/**
 * Get skill installation path for an agent
 */
export function getSkillPath(agent: Agent, skillName: string, global: boolean, cwd = process.cwd()): string {
  const basePath = getAgentBasePath(agent, global, cwd);
  return join(basePath, sanitizeSkillDirName(skillName));
}
