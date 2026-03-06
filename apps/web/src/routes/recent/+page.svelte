<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Notification01Icon } from '@hugeicons/core-free-icons';
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
    `${SITE_URL}/recent${data.pagination.currentPage > 1 ? `?page=${data.pagination.currentPage}` : ''}`
  );
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'recent' });
  const pageTitle = $derived(
    `${messages.lists.recentTitle}${data.pagination.currentPage > 1 ? i18n.t(messages.common.pageSuffix, { page: data.pagination.currentPage }) : ''} - SkillsCat`
  );
  const pageDescription = $derived(messages.lists.recentDescription);
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
  image={ogImageUrl}
  imageAlt={messages.legal.recentImageAlt}
  keywords={['new ai skills', 'recent ai agent skills', 'skillscat recent']}
  structuredData={structuredData}
/>

<ListPage
  title={messages.lists.recentTitle}
  description={messages.lists.recentDescription}
  skills={data.skills}
  emptyMessage={messages.lists.recentEmpty}
  pagination={data.pagination}
>
  {#snippet icon()}
    <HugeiconsIcon icon={Notification01Icon} strokeWidth={2} />
  {/snippet}
</ListPage>
