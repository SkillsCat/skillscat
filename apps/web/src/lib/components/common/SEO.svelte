<script lang="ts">
  import { buildOgImageUrl, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from '$lib/seo/og';
  import { SITE_DESCRIPTION, SITE_LOCALE, SITE_NAME, SITE_URL } from '$lib/seo/constants';

  /**
   * SEO Component - 结构化数据和 Meta 标签
   */

  interface Props {
    title: string;
    description: string;
    url?: string;
    image?: string;
    imageAlt?: string;
    type?: 'website' | 'article' | 'product' | 'profile';
    publishedTime?: string;
    modifiedTime?: string;
    author?: string;
    keywords?: string[];
    noindex?: boolean;
    structuredData?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  }

  let {
    title,
    description,
    url = '',
    image = buildOgImageUrl({ type: 'page', slug: 'home' }),
    imageAlt = title,
    type = 'website',
    publishedTime,
    modifiedTime,
    author,
    keywords = [],
    noindex = false,
    structuredData,
  }: Props = $props();

  const siteName = SITE_NAME;
  const siteUrl = SITE_URL;
  const locale = SITE_LOCALE;

  const fullUrl = $derived(
    url
      ? (url.startsWith('http://') || url.startsWith('https://') ? url : `${siteUrl}${url}`)
      : siteUrl
  );
  const fullImage = $derived(
    image.startsWith('http://') || image.startsWith('https://') ? image : `${siteUrl}${image}`
  );
  const hasCanonical = $derived(Boolean(url) || !noindex);
  const robotsContent = $derived(
    noindex
      ? 'noindex, nofollow, noarchive'
      : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
  );

  // Default structured data for the website
  const defaultStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: siteUrl,
    description: SITE_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  const jsonLd = $derived(
    structuredData === undefined ? (noindex ? null : defaultStructuredData) : structuredData
  );
  const safeJsonLd = $derived(
    jsonLd ? JSON.stringify(jsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') : ''
  );
</script>

<svelte:head>
  <!-- Primary Meta Tags -->
  <title>{title}</title>
  <meta name="title" content={title} />
  <meta name="description" content={description} />
  {#if author}
    <meta name="author" content={author} />
  {/if}
  {#if keywords.length > 0}
    <meta name="keywords" content={keywords.join(', ')} />
  {/if}
  <meta name="robots" content={robotsContent} />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content={type} />
  <meta property="og:url" content={fullUrl} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:site_name" content={siteName} />
  <meta property="og:locale" content={locale} />
  <meta property="og:image" content={fullImage} />
  <meta property="og:image:secure_url" content={fullImage} />
  <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
  <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
  <meta property="og:image:alt" content={imageAlt} />
  {#if publishedTime}
    <meta property="article:published_time" content={publishedTime} />
  {/if}
  {#if modifiedTime}
    <meta property="article:modified_time" content={modifiedTime} />
  {/if}
  {#if author}
    <meta property="article:author" content={author} />
  {/if}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content={fullUrl} />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={fullImage} />
  <meta name="twitter:image:alt" content={imageAlt} />

  <!-- Canonical URL -->
  {#if hasCanonical}
    <link rel="canonical" href={fullUrl} />
    <link rel="alternate" hreflang="en" href={fullUrl} />
    <link rel="alternate" hreflang="x-default" href={fullUrl} />
  {/if}

  <!-- Structured Data -->
  {#if safeJsonLd}
    {@html `<script type="application/ld+json">${safeJsonLd}</script>`}
  {/if}
</svelte:head>
