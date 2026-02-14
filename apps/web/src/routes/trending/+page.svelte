<script lang="ts">
  import ListPage from '$lib/components/layout/ListPage.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Fire03Icon } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';
  import { buildOgImageUrl, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from '$lib/seo/og';
  import { SITE_DESCRIPTION } from '$lib/seo/constants';

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
    `https://skills.cat/trending${data.pagination.currentPage > 1 ? `?page=${data.pagination.currentPage}` : ''}`
  );
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'trending' });
</script>

<svelte:head>
  <title>Trending Skills{data.pagination.currentPage > 1 ? ` - Page ${data.pagination.currentPage}` : ''} - SkillsCat</title>
  <meta name="description" content={SITE_DESCRIPTION} />
  <link
    rel="canonical"
    href={canonicalUrl}
  />
  <meta property="og:title" content="Trending Skills - SkillsCat" />
  <meta property="og:description" content={SITE_DESCRIPTION} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:image" content={ogImageUrl} />
  <meta property="og:image:secure_url" content={ogImageUrl} />
  <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
  <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
  <meta property="og:image:alt" content="Trending skills social preview image" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Trending Skills - SkillsCat" />
  <meta name="twitter:description" content={SITE_DESCRIPTION} />
  <meta name="twitter:image" content={ogImageUrl} />
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
