export { default as HugeiconsIcon } from './HugeiconsIcon.svelte';

type IconAttrValue = string | number | boolean | null | undefined;
type IconAttrs = Readonly<Record<string, IconAttrValue>>;
export type IconSvgElement = readonly (readonly [string, IconAttrs])[];
