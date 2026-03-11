import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectPreferredAgents,
  getAgentById,
  getSkillPath,
  type Agent
} from '../src/utils/agents/agents';
import { createWorkspace } from './helpers/env';

const TEST_AGENT: Agent = {
  id: 'test',
  name: 'Test Agent',
  projectPath: '.test-agent/skills/',
  globalPath: '/tmp/test-agent/skills'
};

describe('getSkillPath', () => {
  it('prevents path traversal in skill names', () => {
    const path = getSkillPath(TEST_AGENT, '../outside', true);
    expect(path).toBe(join(TEST_AGENT.globalPath, '-outside'));
  });

  it('normalizes unsafe filesystem characters', () => {
    const path = getSkillPath(TEST_AGENT, 'my:skill*name', false);
    expect(path).toBe(join(process.cwd(), '.test-agent/skills/my-skill-name'));
  });
});

describe('getAgentById', () => {
  it('includes OpenClaw as a supported install target', () => {
    expect(getAgentById('openclaw')).toMatchObject({
      id: 'openclaw',
      name: 'OpenClaw',
      projectPath: 'skills/',
    });
  });

  it('resolves the generic .agents target by alias', () => {
    expect(getAgentById('.agents')).toMatchObject({
      id: 'agents',
      name: '.agents',
      projectPath: '.agents/',
    });
  });
});

describe('detectPreferredAgents', () => {
  it('falls back to .agents when no agent-specific directory exists', () => {
    const workspace = createWorkspace('agents-fallback');
    const agents = detectPreferredAgents(false, workspace);

    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe('agents');
  });

  it('prefers an existing project-specific directory over the fallback', () => {
    const workspace = createWorkspace('agents-project');
    mkdirSync(join(workspace, '.agents'), { recursive: true });
    const claudeDir = join(workspace, '.claude', 'skills');
    mkdirSync(claudeDir, { recursive: true });
    expect(existsSync(claudeDir)).toBe(true);

    const agents = detectPreferredAgents(false, workspace);

    expect(agents.map((agent) => agent.id)).toContain('claude-code');
    expect(agents.map((agent) => agent.id)).not.toContain('agents');
  });
});
