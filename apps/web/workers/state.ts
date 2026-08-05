export { SkillscatStateDurableObject } from '../src/lib/server/state/durable-object';

export default {
  async fetch(): Promise<Response> {
    return new Response('SkillsCat state worker', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  },
};
