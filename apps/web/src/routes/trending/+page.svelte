<script lang="ts">
  import { ListPage } from '$lib/components';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Fire03Icon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      skills: SkillCardData[];
    };
  }

  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Trending Skills - SkillsCat</title>
  <meta name="description" content="Discover the hottest trending Claude Code skills right now." />
</svelte:head>

<ListPage
  title="Trending Skills"
  description="The hottest skills gaining momentum in the community right now."
  skills={data.skills}
  emptyMessage="No trending skills yet"
>
  {#snippet icon()}
    <HugeiconsIcon icon={Fire03Icon} strokeWidth={2} />
  {/snippet}
</ListPage>
