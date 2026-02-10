<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { StarIcon } from '@hugeicons/core-free-icons';
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
  <title>Top Rated Skills{data.pagination.currentPage > 1 ? ` - Page ${data.pagination.currentPage}` : ''} - SkillsCat</title>
  <meta name="description" content="The most starred and loved Claude Code skills by the community." />
</svelte:head>

<ListPage
  title="Top Rated"
  description="The most starred skills loved by the community. Quality guaranteed!"
  skills={data.skills}
  emptyMessage="No top rated skills yet"
  pagination={data.pagination}
>
  {#snippet icon()}
    <HugeiconsIcon icon={StarIcon} strokeWidth={2} />
  {/snippet}
</ListPage>
