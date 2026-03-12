import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const target = `/cli/auth${url.search}`;
  throw redirect(308, target);
};
