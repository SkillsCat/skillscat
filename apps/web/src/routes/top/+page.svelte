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
  <title>Top Rated Skills - SkillsCat</title>
  <meta name="description" content="The most starred and loved Claude Code skills by the community." />
</svelte:head>

<ListPage
  title="Top Rated"
  emoji="⭐"
  description="The most starred skills loved by the community. Quality guaranteed!"
  skills={data.skills}
  emptyMessage="No top rated skills yet"
/>
