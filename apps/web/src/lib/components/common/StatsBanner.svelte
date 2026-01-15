<script lang="ts">
  interface Props {
    count: number;
  }

  let { count }: Props = $props();
</script>

<div class="card bg-primary-subtle/50 border-primary/20">
  <div class="flex items-center justify-center gap-2 py-2">
    <span class="text-2xl">✨</span>
    <span class="text-lg font-medium text-fg">
      SkillsCat has already found
      <span class="text-primary font-bold mx-1">{count.toLocaleString()}</span>
      agent skills
    </span>
  </div>
</div>
