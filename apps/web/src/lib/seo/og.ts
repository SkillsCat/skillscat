const SITE_URL = 'https://skills.cat';

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export type OgImageTarget =
  | { type: 'skill'; slug: string }
  | { type: 'user'; slug: string }
  | { type: 'org'; slug: string }
  | { type: 'category'; slug: string }
  | { type: 'page'; slug: string };

export function buildOgImageUrl(target: OgImageTarget): string {
  const params = new URLSearchParams();
  params.set('type', target.type);
  params.set('slug', target.slug);
  return `${SITE_URL}/og?${params.toString()}`;
}
