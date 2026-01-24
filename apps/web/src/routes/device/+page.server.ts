import type { PageServerLoad } from './$types';
import { getDeviceCodeByUserCode } from '$lib/server/device-auth';

export const load: PageServerLoad = async ({ url, platform, locals }) => {
  const session = await locals.auth?.();
  const userCode = url.searchParams.get('code');

  const db = platform?.env?.DB;

  let deviceInfo = null;
  let error = null;

  if (userCode && db) {
    const info = await getDeviceCodeByUserCode(db, userCode);
    if (info) {
      if (info.status !== 'pending') {
        error = 'This code has already been used';
      } else {
        deviceInfo = {
          userCode: userCode.toUpperCase(),
          clientInfo: info.clientInfo,
          scopes: info.scopes,
          expiresAt: info.expiresAt,
        };
      }
    } else {
      error = 'Invalid or expired code';
    }
  }

  return {
    user: session?.user ?? null,
    deviceInfo,
    error,
    prefillCode: userCode?.toUpperCase() ?? null,
  };
};
