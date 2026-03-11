<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { StarIcon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';
  import { buildOgImageUrl } from '$lib/seo/og';
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
    `${SITE_URL}/top${data.pagination.currentPage > 1 ? `?page=${data.pagination.currentPage}` : ''}`
  );
  const prevUrl = $derived(
    data.pagination.currentPage > 1
      ? `/top${data.pagination.currentPage === 2 ? '' : `?page=${data.pagination.currentPage - 1}`}`
      : ''
  );
  const nextUrl = $derived(
    data.pagination.currentPage < data.pagination.totalPages
      ? `/top?page=${data.pagination.currentPage + 1}`
      : ''
  );
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'top' });
  const pageTitle = $derived(
    `${messages.lists.topTitle}${data.pagination.currentPage > 1 ? i18n.t(messages.common.pageSuffix, { page: data.pagination.currentPage }) : ''} - SkillsCat`
  );
  const pageDescription = $derived(messages.lists.topDescription);
  const structuredData = $derived({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: pageTitle,
    description: pageDescription,
    url: canonicalUrl,
    mainEntity: {
      '@type': 'ItemList',
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      numberOfItems: data.pagination.totalItems,
    },
  });
</script>

<SEO
  title={pageTitle}
  description={pageDescription}
  url={canonicalUrl}
  {prevUrl}
  {nextUrl}
  image={ogImageUrl}
  imageAlt={messages.legal.topImageAlt}
  keywords={['top ai skills', 'best ai agent skills', 'skillscat top rated']}
  structuredData={structuredData}
/>

<ListPage
  title={messages.lists.topTitle}
  description={messages.lists.topDescription}
  skills={data.skills}
  emptyMessage={messages.lists.topEmpty}
  pagination={data.pagination}
>
  {#snippet icon()}
    <HugeiconsIcon icon={StarIcon} strokeWidth={2} />
  {/snippet}
</ListPage>
