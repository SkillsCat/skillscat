<script lang="ts">
  import { Select } from 'bits-ui';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import type { SupportedLocale } from '$lib/i18n/config';
  import { useI18n } from '$lib/i18n/runtime';
  import { ArrowDown01Icon, EarthIcon } from '@hugeicons/core-free-icons';

  const compactLocaleLabels: Record<SupportedLocale, string> = {
    en: 'EN',
    'zh-CN': '简中',
    ja: '日本語',
    ko: '한국어',
  };

  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const locales = $derived(i18n.availableLocales());
  const currentLocale = $derived(i18n.locale());
  const currentLocaleLabel = $derived(compactLocaleLabels[currentLocale]);

  async function handleLocaleChange(nextLocale: string): Promise<void> {
    await i18n.switchLocale(nextLocale as SupportedLocale);
  }
</script>

<Select.Root type="single" value={currentLocale} onValueChange={handleLocaleChange}>
  <Select.Trigger class="locale-switcher-trigger" aria-label={messages.footer.language}>
    <HugeiconsIcon icon={EarthIcon} size={15} class="locale-trigger-icon" strokeWidth={1.9} />
    <span class="locale-trigger-value">{currentLocaleLabel}</span>
    <HugeiconsIcon icon={ArrowDown01Icon} size={14} class="locale-switcher-chevron" strokeWidth={2} />
  </Select.Trigger>

  <Select.Portal>
    <Select.Content class="locale-switcher-content" sideOffset={8}>
      {#each locales as locale}
        <Select.Item value={locale.code} class="locale-switcher-item">
          <span class="locale-option-name">{locale.label}</span>
          <span class="locale-option-code">{compactLocaleLabels[locale.code]}</span>
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.locale-switcher-trigger) {
    --locale-trigger-shadow-offset: 4px;
    --locale-trigger-ambient-shadow: 0 8px 18px -18px rgba(0, 0, 0, 0.4);

    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    padding: 0.45rem 0.65rem;
    color: var(--foreground);
    background:
      radial-gradient(circle at top left, var(--accent-subtle), transparent 50%),
      linear-gradient(135deg, var(--card), color-mix(in oklch, var(--primary-subtle) 70%, white));
    border: 2px solid var(--border-sketch);
    border-radius: var(--radius-full);
    box-shadow:
      0 var(--locale-trigger-shadow-offset) 0 0 var(--border-sketch),
      var(--locale-trigger-ambient-shadow);
    cursor: pointer;
    transform: translateY(0);
    transition:
      transform var(--duration-fast) var(--ease-spring),
      box-shadow var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default);
  }

  :global(.locale-switcher-trigger:hover) {
    --locale-trigger-shadow-offset: 6px;
    --locale-trigger-ambient-shadow: 0 10px 20px -18px rgba(0, 0, 0, 0.45);

    border-color: var(--primary);
    transform: translateY(-2px);
  }

  :global(.locale-switcher-trigger:active) {
    --locale-trigger-shadow-offset: 1px;
    --locale-trigger-ambient-shadow: 0 0 0 0 transparent;

    border-color: var(--primary);
    transform: translateY(3px);
  }

  :global(.locale-switcher-trigger[data-state="open"]) {
    --locale-trigger-shadow-offset: 1px;
    --locale-trigger-ambient-shadow: 0 0 0 0 transparent;

    border-color: var(--primary);
    transform: translateY(3px);
  }

  :global(.locale-switcher-trigger:focus-visible) {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }

  :global(.locale-trigger-icon) {
    color: var(--primary);
    flex-shrink: 0;
  }

  .locale-trigger-value {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--fg);
  }

  :global(.locale-switcher-chevron) {
    color: var(--fg-muted);
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease-default);
  }

  :global(.locale-switcher-trigger[data-state="open"] .locale-switcher-chevron) {
    transform: rotate(180deg);
  }

  :global(.locale-switcher-content) {
    width: max(10.5rem, var(--bits-select-trigger-width));
    padding: 0.35rem;
    background:
      linear-gradient(180deg, color-mix(in oklch, var(--card) 92%, white), var(--card));
    border: 2px solid var(--border-sketch);
    border-radius: var(--radius-lg);
    box-shadow:
      0 4px 0 0 var(--border-sketch),
      0 14px 26px -24px rgba(0, 0, 0, 0.55);
    z-index: 100;
  }

  :global(.locale-switcher-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      transform var(--duration-fast) var(--ease-default),
      background var(--duration-fast) var(--ease-default);
  }

  :global(.locale-switcher-item:hover),
  :global(.locale-switcher-item[data-highlighted]) {
    background: linear-gradient(135deg, var(--primary-subtle), var(--accent-subtle));
    transform: translateX(1px);
  }

  :global(.locale-switcher-item[data-state="checked"]) {
    background: linear-gradient(135deg, var(--primary-subtle), var(--accent-subtle));
    color: var(--primary);
  }

  .locale-option-name {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--fg);
  }

  :global(.locale-switcher-item[data-state="checked"] .locale-option-name) {
    color: var(--primary);
  }

  .locale-option-code {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    padding: 0.15rem 0.35rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--fg-muted);
    background: var(--bg-muted);
    border-radius: 9999px;
  }

  :global(.locale-switcher-item[data-state="checked"] .locale-option-code) {
    color: var(--primary-foreground);
    background: var(--primary);
  }

  :global(:root.dark .locale-switcher-trigger) {
    --locale-trigger-ambient-shadow: 0 8px 18px -20px rgba(0, 0, 0, 0.8);

    box-shadow:
      0 var(--locale-trigger-shadow-offset) 0 0 var(--border-sketch),
      var(--locale-trigger-ambient-shadow);
  }

  :global(:root.dark .locale-switcher-content) {
    box-shadow:
      0 4px 0 0 var(--border-sketch),
      0 14px 30px -24px rgba(0, 0, 0, 0.85);
  }
</style>
