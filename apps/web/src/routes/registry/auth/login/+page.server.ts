import type { PageServerLoad } from './$types';
import { getCliAuthSession } from '$lib/server/cli-auth';

export const load: PageServerLoad = async ({ url, platform, locals }) => {
  const session = await locals.auth?.();
  const sessionId = url.searchParams.get('session');

  const db = platform?.env?.DB;

  let cliSession = null;
  let error = null;

  if (sessionId && db) {
    const info = await getCliAuthSession(db, sessionId);
    if (info) {
      if (info.status !== 'pending') {
        error = 'This session has already been processed';
      } else {
        cliSession = {
          sessionId: info.id,
          clientInfo: info.clientInfo,
          scopes: info.scopes,
          expiresAt: info.expiresAt,
        };
      }
    } else {
      error = 'Invalid or expired session';
    }
  }

  return {
    user: session?.user ?? null,
    cliSession,
    error,
    sessionId,
  };
};
