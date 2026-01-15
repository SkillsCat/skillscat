<script lang="ts">
  import { ListPage } from '$lib/components';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      skills: SkillCardData[];
    };
  }

  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Recently Added Skills - SkillsCat</title>
  <meta name="description" content="Discover the newest Claude Code skills added to the collection." />
</svelte:head>

<ListPage
  title="Recently Added"
  emoji="🆕"
  description="Fresh skills just added to the collection. Be the first to try them out!"
  skills={data.skills}
  emptyMessage="No skills added yet"
/>
