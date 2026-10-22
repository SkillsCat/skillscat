<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { tick } from 'svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import NavbarCategoriesContent from '$lib/components/layout/NavbarCategoriesContent.svelte';
  import { ArrowDown01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    label: string;
    value?: string;
    active?: boolean;
  }

  let { label, value = $bindable(''), active = false }: Props = $props();
  let container: HTMLDivElement;
  let viewportShift = $state(0);

  $effect(() => {
    if (!value) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const alignViewport = () => {
      const viewport = container.querySelector<HTMLElement>('.nav-viewport');
      if (!viewport) return;
      const anchor = container.getBoundingClientRect();
      const width = viewport.getBoundingClientRect().width;
      const left = anchor.left + anchor.width / 2 - width / 2;
      viewportShift = Math.max(8 - left, Math.min(0, window.innerWidth - 8 - left - width));
    };
    void tick().then(() => {
      if (disposed) return;
      alignViewport();
      const viewport = container.querySelector<HTMLElement>('.nav-viewport');
      if (viewport) {
        observer = new ResizeObserver(alignViewport);
        observer.observe(viewport);
      }
      window.addEventListener('resize', alignViewport);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', alignViewport);
    };
  });
</script>

<div bind:this={container} style:--category-menu-shift={`${viewportShift}px`}>
<NavigationMenu.Root class="nav-menu-root" bind:value={value}>
  <NavigationMenu.List class="nav-menu-list">
    <NavigationMenu.Item value="categories">
      <NavigationMenu.Trigger
        class="nav-link nav-trigger"
        data-active={active ? '' : undefined}
      >
        {label}
        <span class="nav-link-chevron">
          <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
        </span>
      </NavigationMenu.Trigger>

      <NavigationMenu.Content class="nav-content">
        <div><NavbarCategoriesContent /></div>
      </NavigationMenu.Content>
    </NavigationMenu.Item>

    <NavigationMenu.Indicator class="nav-indicator">
      <div class="nav-indicator-arrow"></div>
    </NavigationMenu.Indicator>
  </NavigationMenu.List>

  <NavigationMenu.Viewport class="nav-viewport" style="left: calc(50% + var(--category-menu-shift));" />
</NavigationMenu.Root>

</div>
