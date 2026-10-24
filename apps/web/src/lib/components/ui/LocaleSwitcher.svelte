<script lang="ts">
  import { Select } from 'bits-ui';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import type { SupportedLocale } from '$lib/i18n/config';
  import { useI18n } from '$lib/i18n/runtime';
  import { ArrowDown01Icon, EarthIcon, Tick02Icon } from '@hugeicons/core-free-icons';

  const compactLocaleLabels: Record<SupportedLocale, string> = {
    en: 'EN', ca: 'CA', 'zh-CN': '简中', ja: '日本語', ko: '한국어',
  };
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const locales = $derived(i18n.availableLocales());
  const currentLocale = $derived(i18n.locale());
  const currentLabel = $derived(locales.find((locale) => locale.code === currentLocale)?.label);
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let content = $state<HTMLDivElement | null>(null);

  function selectLocale(value: string) {
    const locale = locales.find((locale) => locale.code === value);
    if (locale) void i18n.switchLocale(locale.code);
  }

  function dismissOutsideClick(event: MouseEvent) {
    // Complete taps can arrive before the library's deferred touch listener.
    // Keep inside clicks (including the portalled menu) with the Select itself.
    const path = event.composedPath();
    if (open && !path.some((node) => node === trigger || node === content)) {
      open = false;
    }
  }
</script>

<svelte:document onclick={dismissOutsideClick} />

<Select.Root type="single" bind:open value={currentLocale} onValueChange={selectLocale} allowDeselect={false}>
  <Select.Trigger
    bind:ref={trigger}
    class="locale-switcher"
    aria-label={`${messages.footer.language}: ${currentLabel}`}
  >
    <HugeiconsIcon icon={EarthIcon} size={16} class="locale-icon" strokeWidth={1.9} />
    <span class="locale-label" aria-hidden="true">{compactLocaleLabels[currentLocale]}</span>
    <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content bind:ref={content} class="locale-menu" aria-label={messages.footer.language} side="top" align="end" sideOffset={12} collisionPadding={12}>
      <Select.Viewport>
        {#each locales as locale (locale.code)}
          <Select.Item class="locale-option" value={locale.code} label={locale.label}>
            {#snippet children({ selected })}
              <span lang={locale.code}>{locale.label}</span>
              <span class="locale-check" aria-hidden="true">
                {#if selected}<HugeiconsIcon icon={Tick02Icon} size={18} strokeWidth={2} />{/if}
              </span>
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.locale-switcher) {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.75rem;
    padding: 0.45rem 0.65rem;
    color: var(--foreground);
    background: var(--card);
    border: 2px solid var(--border-sketch);
    border-radius: var(--radius-full);
    box-shadow: 0 4px 0 var(--border-sketch);
    cursor: pointer;
  }
  :global(.locale-switcher:focus-visible) {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
  :global(.locale-switcher:hover), :global(.locale-switcher[data-state='open']) { border-color: var(--primary); }
  :global(.locale-switcher .locale-icon) { color: var(--primary); }
  .locale-label { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.02em; }
  :global(.locale-menu) {
    z-index: 60;
    width: 12rem;
    max-width: calc(100vw - 1.5rem);
    max-height: var(--bits-select-content-available-height);
    overflow-y: auto;
    padding: 0.375rem;
    color: var(--popover-foreground);
    background: var(--popover);
    border: 2px solid var(--border-sketch);
    border-radius: 1.25rem;
    box-shadow: 0 4px 0 var(--border-sketch), 0 12px 28px rgb(0 0 0 / 0.14);
    outline: none;
  }
  :global(.locale-option) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 2.75rem;
    padding: 0.6rem 0.75rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    outline: none;
  }
  :global(.locale-option[data-selected]) {
    color: var(--primary);
    font-weight: 700;
  }
  :global(.locale-option[data-highlighted]) {
    color: var(--foreground);
    background: var(--primary-subtle);
  }
  .locale-check { display: flex; width: 1.125rem; color: var(--primary); }
</style>
