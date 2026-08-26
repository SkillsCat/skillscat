import type { RequestHandler } from './$types';
import {
  resolveAgentSkillArtifact,
  resolveAgentSkillArtifactHead,
} from '$lib/server/agent/skills-discovery';

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'private, no-cache',
  'CDN-Cache-Control': 'no-store',
  'Content-Type': 'text/markdown; charset=utf-8',
  Vary: 'Origin',
  'X-Content-Type-Options': 'nosniff',
};

export const GET: RequestHandler = async ({ platform, url }) => {
  const resolved = await resolveAgentSkillArtifact({
    db: platform?.env?.DB,
    r2: platform?.env?.R2,
    slug: url.searchParams.get('slug'),
    digest: url.searchParams.get('digest'),
    waitUntil: platform?.context?.waitUntil?.bind(platform.context),
  });

  if (resolved.content === null) {
    return new Response(resolved.error || 'Skill artifact unavailable', {
      status: resolved.status,
      headers: {
        ...BASE_HEADERS,
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Cache': resolved.cacheStatus,
      },
    });
  }

  return new Response(resolved.content, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'X-Cache': resolved.cacheStatus,
    },
  });
};

export const HEAD: RequestHandler = async ({ platform, url }) => {
  const resolved = await resolveAgentSkillArtifactHead({
    db: platform?.env?.DB,
    slug: url.searchParams.get('slug'),
    digest: url.searchParams.get('digest'),
  });

  return new Response(null, {
    status: resolved.status,
    headers: {
      ...BASE_HEADERS,
      ...(resolved.status === 200 ? {} : {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      }),
      'X-Cache': resolved.cacheStatus,
    },
  });
};
