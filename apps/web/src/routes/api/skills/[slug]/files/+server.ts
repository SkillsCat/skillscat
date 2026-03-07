import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSkillFilesInput, resolveSkillFiles } from '$lib/server/skill-files';

export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const input = parseSkillFilesInput({ slug: params.slug });
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const githubToken = platform?.env?.GITHUB_TOKEN;

  if (!input) {
    return json({ error: 'Invalid skill slug' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const resolved = await resolveSkillFiles({
      db,
      r2,
      githubToken,
      request,
      locals,
    }, input);

    return json(resolved.data, {
      headers: {
        'Cache-Control': resolved.cacheControl,
      }
    });
  } catch (err) {
    throw err;
  }
};
