import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ locals }) => {
  const session = await locals.auth?.();
  if (!session?.user) {
    throw redirect(302, '/');
  }

  return {};
};
