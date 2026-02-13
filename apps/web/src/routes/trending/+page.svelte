<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Fire03Icon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';

  interface PaginationData {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    baseUrl: string;
  }

  interface Props {
    data: {
      skills: SkillCardData[];
      pagination: PaginationData;
    };
  }

  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Trending Skills{data.pagination.currentPage > 1 ? ` - Page ${data.pagination.currentPage}` : ''} - SkillsCat</title>
  <meta name="description" content="Discover the hottest trending AI agent skills right now." />
</svelte:head>

<ListPage
  title="Trending Skills"
  description="The hottest skills gaining momentum in the community right now."
  skills={data.skills}
  emptyMessage="No trending skills yet"
  pagination={data.pagination}
>
  {#snippet icon()}
    <HugeiconsIcon icon={Fire03Icon} strokeWidth={2} />
  {/snippet}
</ListPage>
