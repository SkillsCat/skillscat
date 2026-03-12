<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import NavbarCategoriesContent from '$lib/components/layout/NavbarCategoriesContent.svelte';
  import { ArrowDown01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    label: string;
    value?: string;
    active?: boolean;
  }

  let { label, value = $bindable(''), active = false }: Props = $props();
</script>

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
        <NavbarCategoriesContent />
      </NavigationMenu.Content>
    </NavigationMenu.Item>

    <NavigationMenu.Indicator class="nav-indicator">
      <div class="nav-indicator-arrow"></div>
    </NavigationMenu.Indicator>
  </NavigationMenu.List>

  <NavigationMenu.Viewport class="nav-viewport" />
</NavigationMenu.Root>
