import { SITE_URL } from './constants';

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

type OgImageTargetBase = {
  slug: string;
  version?: string | number;
};

export type OgImageTarget =
  | ({ type: 'skill' } & OgImageTargetBase)
  | ({ type: 'user' } & OgImageTargetBase)
  | ({ type: 'org' } & OgImageTargetBase)
  | ({ type: 'category' } & OgImageTargetBase)
  | ({ type: 'page' } & OgImageTargetBase);

export function buildOgImageUrl(target: OgImageTarget): string {
  const params = new URLSearchParams();
  params.set('type', target.type);
  params.set('slug', target.slug);
  if (target.version !== undefined && target.version !== null && `${target.version}`.trim() !== '') {
    params.set('v', String(target.version));
  }
  return `${SITE_URL}/og?${params.toString()}`;
}
