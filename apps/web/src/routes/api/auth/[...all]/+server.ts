import { createAuth, resolveAuthBaseURL, type AuthEnv } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env as AuthEnv;
  if (!env?.DB) {
    return new Response('Database not available', { status: 503 });
  }
  const auth = createAuth(env, resolveAuthBaseURL(env, `${new URL(request.url).origin}`));
  return auth.handler(request);
};

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env as AuthEnv;
  if (!env?.DB) {
    return new Response('Database not available', { status: 503 });
  }
  const auth = createAuth(env, resolveAuthBaseURL(env, `${new URL(request.url).origin}`));
  return auth.handler(request);
};
