import type { Reroute } from '@sveltejs/kit';
import { isLocalizedPublicPath, stripSeoLocale } from '$lib/seo/locale-path';

// The visible URL is retained. Both SSR and client navigation reuse the same route.
export const reroute: Reroute = ({ url }) => {
  if (isLocalizedPublicPath(url.pathname)) {
    return stripSeoLocale(url.pathname);
  }
  return url.pathname;
};
