import { describe, expect, it } from 'vitest';

describe('A2A Agent Card', () => {
  it('publishes a discoverable Agent Card with the required fields', async () => {
    const { GET } = await import('../src/routes/.well-known/agent-card.json/+server');
    const response = await GET({} as never);
    const card = await response.json() as {
      name: string;
      version: string;
      description: string;
      supportedInterfaces: Array<{
        url: string;
        protocolBinding: string;
        protocolVersion: string;
      }>;
      capabilities: Record<string, unknown>;
      skills: Array<{ id: string; name: string; description: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(card.name).toBe('SkillsCat');
    expect(card.version).toBeTruthy();
    expect(card.description).toBeTruthy();
    expect(card.supportedInterfaces).toEqual([
      expect.objectContaining({
        url: 'https://skills.cat/a2a',
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '1.0',
      }),
    ]);
    expect(card.capabilities).toEqual(expect.objectContaining({
      streaming: false,
      pushNotifications: false,
    }));
    expect(card.skills.length).toBeGreaterThan(0);
    for (const skill of card.skills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
    }
  });

  it('supports HEAD requests without a response body', async () => {
    const { HEAD } = await import('../src/routes/.well-known/agent-card.json/+server');
    const response = await HEAD({} as never);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
