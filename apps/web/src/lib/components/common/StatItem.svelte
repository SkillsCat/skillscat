<script lang="ts">
  interface Props {
    label: string;
    value: string | number;
  }

  let { label, value }: Props = $props();
</script>

<div class="text-center">
  <div class="text-2xl font-bold text-fg">{typeof value === 'number' ? value.toLocaleString() : value}</div>
  <div class="text-sm text-fg-muted">{label}</div>
</div>
