import { SITE_URL } from './constants';

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_VERSION = '2026-03-01';

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
  const versionValue = target.version !== undefined && target.version !== null && `${target.version}`.trim() !== ''
    ? String(target.version)
    : OG_IMAGE_VERSION;
  params.set('v', versionValue);
  return `${SITE_URL}/og?${params.toString()}`;
}
