<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements';

  type IconAttrValue = string | number | boolean | null | undefined;
  type IconAttrs = Readonly<Record<string, IconAttrValue>>;
  export type IconSvgElement = readonly (readonly [string, IconAttrs])[];

  interface Props extends SVGAttributes<SVGSVGElement> {
    icon: IconSvgElement;
    altIcon?: IconSvgElement;
    size?: string | number;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    color?: string;
    showAlt?: boolean;
    class?: string;
    /**
     * @deprecated Use `class` prop instead.
     */
    className?: string;
  }

  let {
    icon,
    altIcon,
    size = 24,
    strokeWidth,
    absoluteStrokeWidth = false,
    color = 'currentColor',
    showAlt = false,
    class: className = '',
    className: legacyClassName = '',
    ...restProps
  }: Props = $props();

  const finalClassName = $derived(className || legacyClassName);

  function camelToKebab(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  const iconNodes = $derived((showAlt && altIcon ? altIcon : icon) || []);

  const calculatedStrokeWidth = $derived.by(() => {
    if (strokeWidth === undefined) return undefined;
    if (!absoluteStrokeWidth) return strokeWidth;
    return strokeWidth * (24 / Number(size));
  });

  const renderedNodes = $derived.by(() => {
    return iconNodes.map(([tag, attrs]) => {
      const renderedAttrs: Record<string, string | number> = {};

      for (const [key, value] of Object.entries(attrs || {})) {
        if (value === undefined || value === null || value === false) continue;
        renderedAttrs[camelToKebab(key)] = value as string | number;
      }

      if (calculatedStrokeWidth !== undefined) {
        renderedAttrs['stroke-width'] = calculatedStrokeWidth;
        renderedAttrs.stroke = 'currentColor';
      }

      return { tag, attrs: renderedAttrs };
    });
  });
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  color={color}
  class={finalClassName}
  {...restProps}
>
  {#each renderedNodes as node, index (`${node.tag}-${index}`)}
    <svelte:element this={node.tag} {...node.attrs} />
  {/each}
</svg>
