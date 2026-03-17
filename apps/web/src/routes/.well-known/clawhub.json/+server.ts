import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SITE_URL } from '$lib/seo/constants';
import { OPENCLAW_REGISTRY_BASE_PATH } from '$lib/server/openclaw/registry';

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

function buildPayload() {
  return {
    apiBase: `${SITE_URL}${OPENCLAW_REGISTRY_BASE_PATH}`,
    authBase: SITE_URL,
    minCliVersion: '0.0.5',
  };
}

export const GET: RequestHandler = async () =>
  json(buildPayload(), {
    headers: {
      'Cache-Control': CACHE_CONTROL,
    },
  });

export const HEAD = GET;
