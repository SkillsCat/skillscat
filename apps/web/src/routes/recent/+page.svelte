<script lang="ts">
  import { ListPage } from '$lib/components';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Notification01Icon } from '@hugeicons/core-free-icons';
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
  <title>Recently Added Skills{data.pagination.currentPage > 1 ? ` - Page ${data.pagination.currentPage}` : ''} - SkillsCat</title>
  <meta name="description" content="Discover the newest Claude Code skills added to the collection." />
</svelte:head>

<ListPage
  title="Recently Added"
  description="Fresh skills just added to the collection. Be the first to try them out!"
  skills={data.skills}
  emptyMessage="No skills added yet"
  pagination={data.pagination}
>
  {#snippet icon()}
    <HugeiconsIcon icon={Notification01Icon} strokeWidth={2} />
  {/snippet}
</ListPage>
