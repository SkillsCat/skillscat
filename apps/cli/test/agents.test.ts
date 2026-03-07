import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { getAgentById, getSkillPath, type Agent } from '../src/utils/agents/agents';

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
});
