import { error } from '@sveltejs/kit';
import { getCatalanArticle } from '$lib/content/catalan-blog';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  const article = getCatalanArticle(params.slug);
  if (!article) error(404, 'No s’ha trobat aquest article.');
  return { article };
};
