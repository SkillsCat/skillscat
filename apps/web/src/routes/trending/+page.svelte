<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Fire03Icon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { buildCollectionPageStructuredData, buildSkillListItemElements } from '$lib/seo/schema';
  import { SITE_URL } from '$lib/seo/constants';

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
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const canonicalUrl = $derived(
    `${SITE_URL}/trending${data.pagination.currentPage > 1 ? `?page=${data.pagination.currentPage}` : ''}`
  );
  const prevUrl = $derived(
    data.pagination.currentPage > 1
      ? `/trending${data.pagination.currentPage === 2 ? '' : `?page=${data.pagination.currentPage - 1}`}`
      : ''
  );
  const nextUrl = $derived(
    data.pagination.currentPage < data.pagination.totalPages
      ? `/trending?page=${data.pagination.currentPage + 1}`
      : ''
  );
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'trending' });
  const pageTitle = $derived(
    `${messages.lists.trendingTitle}${data.pagination.currentPage > 1 ? i18n.t(messages.common.pageSuffix, { page: data.pagination.currentPage }) : ''} - SkillsCat`
  );
  const pageDescription = $derived(messages.lists.trendingDescription);
  const skillListStartPosition = $derived(
    (data.pagination.currentPage - 1) * data.pagination.itemsPerPage + 1
  );
  const skillItemList = $derived(
    buildSkillListItemElements(data.skills, { startPosition: skillListStartPosition })
  );
  const structuredData = $derived(
    buildCollectionPageStructuredData({
      name: pageTitle,
      description: pageDescription,
      url: canonicalUrl,
      numberOfItems: data.pagination.totalItems,
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      itemListElement: skillItemList,
    })
  );
</script>

<SEO
  title={pageTitle}
  description={pageDescription}
  url={canonicalUrl}
  {prevUrl}
  {nextUrl}
  image={ogImageUrl}
  imageAlt={messages.legal.trendingImageAlt}
  keywords={['trending ai skills', 'ai agent skills', 'skillscat trending']}
  structuredData={structuredData}
/>

<ListPage
  title={messages.lists.trendingTitle}
  description={messages.lists.trendingDescription}
  skills={data.skills}
  emptyMessage={messages.lists.trendingEmpty}
  pagination={data.pagination}
>
  {#snippet icon()}
    <HugeiconsIcon icon={Fire03Icon} strokeWidth={2} />
  {/snippet}
</ListPage>
