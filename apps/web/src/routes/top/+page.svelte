<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
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
  const canonicalUrl = $derived(
    `${SITE_URL}/top${data.pagination.currentPage > 1 ? `?page=${data.pagination.currentPage}` : ''}`
  );
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'top' });
  const pageTitle = $derived(
    `Top Rated Skills${data.pagination.currentPage > 1 ? ` - Page ${data.pagination.currentPage}` : ''} - SkillsCat`
  );
  const pageDescription = 'Explore top-rated AI agent skills ranked by community stars and overall quality.';
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
  imageAlt="Top rated skills social preview image"
  keywords={['top ai skills', 'best ai agent skills', 'skillscat top rated']}
  structuredData={structuredData}
/>

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
