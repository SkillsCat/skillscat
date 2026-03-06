<script lang="ts">
  import { useI18n } from '$lib/i18n/runtime';

  interface Props {
    label: string;
    value: string | number;
  }

  let { label, value }: Props = $props();
  const i18n = useI18n();
</script>

<div class="text-center">
  <div class="text-2xl font-bold text-fg">{typeof value === 'number' ? i18n.formatNumber(value) : value}</div>
  <div class="text-sm text-fg-muted">{label}</div>
</div>
