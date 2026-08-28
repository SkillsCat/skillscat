import type { RequestHandler } from './$types';
import { SITE_URL } from '$lib/seo/constants';

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const SCOPES_SUPPORTED = ['read', 'write', 'publish'] as const;

type OAuthMetadataEnv = {
  PUBLIC_APP_URL?: string;
  CLOUDFLARE_ACCESS_ISSUER?: string;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
};

function normalizeUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function resolveAuthorizationServers(env: OAuthMetadataEnv | undefined, resource: string): string[] {
  const configuredValues = [
    env?.CLOUDFLARE_ACCESS_ISSUER,
    env?.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    env?.CF_ACCESS_TEAM_DOMAIN,
  ];
  const configured = configuredValues
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => normalizeUrl(value))
    .filter((value): value is string => value !== null);

  return Array.from(new Set(configured.length > 0 ? configured : [resource]));
}

function buildPayload(env: OAuthMetadataEnv | undefined) {
  const resource = normalizeUrl(env?.PUBLIC_APP_URL) ?? SITE_URL;

  return {
    resource,
    authorization_servers: resolveAuthorizationServers(env, resource),
    scopes_supported: [...SCOPES_SUPPORTED],
    bearer_methods_supported: ['header'],
  };
}

function responseHeaders(): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': CACHE_CONTROL,
    'Cloudflare-CDN-Cache-Control': CACHE_CONTROL,
    'Content-Type': CONTENT_TYPE,
    'X-Cache': 'STATIC',
    'X-Robots-Tag': 'noindex, follow, noarchive',
  });
}

export const GET: RequestHandler = async ({ platform }) => new Response(
  JSON.stringify(buildPayload(platform?.env)),
  {
    status: 200,
    headers: responseHeaders(),
  }
);

export const HEAD: RequestHandler = async () => new Response(null, {
  status: 200,
  headers: responseHeaders(),
});
