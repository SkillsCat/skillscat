<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
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
  const canonicalUrl = $derived(
    `${SITE_URL}/recent${data.pagination.currentPage > 1 ? `?page=${data.pagination.currentPage}` : ''}`
  );
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'recent' });
  const pageTitle = $derived(
    `Recently Added Skills${data.pagination.currentPage > 1 ? ` - Page ${data.pagination.currentPage}` : ''} - SkillsCat`
  );
  const pageDescription = 'Browse newly added AI agent skills and try the latest community contributions first.';
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
  imageAlt="Recently added skills social preview image"
  keywords={['new ai skills', 'recent ai agent skills', 'skillscat recent']}
  structuredData={structuredData}
/>

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
