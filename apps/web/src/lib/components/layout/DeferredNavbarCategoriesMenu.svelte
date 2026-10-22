<script lang="ts">
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { ArrowDown01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    label: string;
    value?: string;
    active?: boolean;
  }

  let { label, value = $bindable(''), active = false }: Props = $props();
  const i18n = useI18n();
  let Menu = $state<typeof import('./NavbarCategoriesMenu.svelte').default | null>(null);
  let root: HTMLDivElement;
  let loading: Promise<void> | undefined;
  let pointerInside = false;
  let keyboardFocus = false;

  function enhance(): Promise<void> {
    return loading ??= import('./NavbarCategoriesMenu.svelte').then(async (module) => {
      const restoreFocus = keyboardFocus;
      Menu = module.default;
      value = pointerInside || keyboardFocus ? 'categories' : '';
      await tick();
      if (restoreFocus) root.querySelector<HTMLButtonElement>('.nav-trigger')?.focus();
    }).catch((error: unknown) => {
      loading = undefined;
      console.warn('Failed to load categories menu:', error);
    });
  }

  async function open(event: MouseEvent) {
    // Preserve native open-in-new-tab and the no-JS categories link.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    keyboardFocus = true;
    await enhance();
    if (Menu) value = 'categories';
    else void goto(i18n.href('/categories'));
  }
</script>

<div bind:this={root} class="nav-menu-root" role="group" aria-label={label}
  onpointerenter={() => { pointerInside = true; void enhance(); }}
  onpointerleave={() => { pointerInside = false; }}
>
  {#if Menu}
    <Menu {label} bind:value {active} />
  {:else}
    <div class="nav-menu-list">
    <a href={i18n.href('/categories')} class="nav-link nav-trigger"
      data-active={active ? '' : undefined}
      onfocus={() => { keyboardFocus = true; void enhance(); }}
      onblur={() => { keyboardFocus = false; }}
      onclick={open}
    >
      {label}
      <span class="nav-link-chevron"><HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} /></span>
    </a>
    </div>
  {/if}
</div>
