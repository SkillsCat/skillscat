import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '$lib/seo/constants';

const AGENT_VERSION = '0.8.1';
const A2A_PROTOCOL_VERSION = '1.0';
const A2A_SERVICE_URL = `${SITE_URL}/a2a`;
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

const AGENT_CARD = {
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  version: AGENT_VERSION,
  supportedInterfaces: [
    {
      url: A2A_SERVICE_URL,
      protocolBinding: 'HTTP+JSON',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
  ],
  provider: {
    organization: SITE_NAME,
    url: SITE_URL,
  },
  documentationUrl: `${SITE_URL}/docs`,
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  },
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['text/plain', 'application/json'],
  skills: [
    {
      id: 'search-skills',
      name: 'Search skills',
      description: 'Find published AI agent skills by query, category, or popularity.',
      tags: ['search', 'discovery', 'skills'],
      examples: ['Find skills for code review', 'Search for browser automation skills'],
    },
    {
      id: 'resolve-repo-skills',
      name: 'Resolve repository skills',
      description: 'Inspect a GitHub repository and identify the skills it contains.',
      tags: ['github', 'repository', 'discovery'],
      examples: ['List the skills in owner/repository'],
    },
    {
      id: 'get-skill-detail',
      name: 'Get skill details',
      description: 'Retrieve metadata, documentation, and installation information for a skill.',
      tags: ['skill', 'metadata', 'documentation'],
      examples: ['Show details for owner/code-review'],
    },
    {
      id: 'get-skill-bundle',
      name: 'Get skill bundle',
      description: 'Retrieve the complete, install-ready file bundle for a published skill.',
      tags: ['skill', 'files', 'installation'],
      examples: ['Download the files for owner/code-review'],
    },
  ],
} as const;

const RESPONSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': CACHE_CONTROL,
  'X-Cache': 'STATIC',
  'X-Robots-Tag': 'noindex, follow, noarchive',
};

export const GET: RequestHandler = async () => json(AGENT_CARD, {
  status: 200,
  headers: RESPONSE_HEADERS,
});

export const HEAD: RequestHandler = async () => new Response(null, {
  status: 200,
  headers: {
    ...RESPONSE_HEADERS,
    'Content-Type': 'application/json',
  },
});
