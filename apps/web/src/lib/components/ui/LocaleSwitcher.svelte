<script lang="ts">
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import type { SupportedLocale } from '$lib/i18n/config';
  import { useI18n } from '$lib/i18n/runtime';
  import { ArrowDown01Icon, EarthIcon } from '@hugeicons/core-free-icons';

  const compactLocaleLabels: Record<SupportedLocale, string> = {
    en: 'EN', 'zh-CN': '简中', ja: '日本語', ko: '한국어',
  };
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const locales = $derived(i18n.availableLocales());
  const currentLocale = $derived(i18n.locale());
</script>

<label class="locale-switcher">
  <HugeiconsIcon icon={EarthIcon} size={15} class="locale-icon" strokeWidth={1.9} />
  <span class="locale-label" aria-hidden="true">{compactLocaleLabels[currentLocale]}</span>
  <select
    aria-label={messages.footer.language}
    value={currentLocale}
    onchange={(event) => void i18n.switchLocale(event.currentTarget.value as SupportedLocale)}
  >
    {#each locales as locale}
      <option value={locale.code}>{locale.label}</option>
    {/each}
  </select>
  <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} />
</label>

<style>
  .locale-switcher {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.45rem 0.65rem;
    color: var(--foreground);
    background: radial-gradient(circle at top left, var(--accent-subtle), transparent 50%),
      linear-gradient(135deg, var(--card), color-mix(in oklch, var(--primary-subtle) 70%, white));
    border: 2px solid var(--border-sketch);
    border-radius: var(--radius-full);
    box-shadow: 0 4px 0 var(--border-sketch);
    cursor: pointer;
  }
  .locale-switcher:focus-within {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
  .locale-switcher:hover { border-color: var(--primary); }
  .locale-switcher :global(.locale-icon) { color: var(--primary); }
  .locale-label { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.02em; }
  select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
</style>
