<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { getLegalDocument } from '$lib/i18n/legal';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const legalDocument = $derived(getLegalDocument(i18n.locale(), 'terms'));
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'terms' });
  const pageDescription = $derived(messages.legal.termsDescription);
  const structuredData = $derived({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: messages.legal.termsTitle,
    description: pageDescription,
    url: `${SITE_URL}/terms`,
  });
</script>

<SEO
  title={messages.legal.termsTitle}
  description={pageDescription}
  url="/terms"
  image={ogImageUrl}
  imageAlt={messages.legal.termsImageAlt}
  keywords={['terms of service', 'skillscat terms', 'legal terms']}
  structuredData={structuredData}
/>

<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <article class="prose prose-lg max-w-none">
    <h1>{legalDocument.title}</h1>
    <p class="lead">{legalDocument.lastUpdated}</p>
    <p>{@html legalDocument.lead}</p>

    {#each legalDocument.sections as section}
      <h2>{section.title}</h2>
      {#if section.paragraphs}
        {#each section.paragraphs as paragraph}
          <p>{@html paragraph}</p>
        {/each}
      {/if}
      {#if section.items}
        <ul>
          {#each section.items as item}
            <li>{@html item}</li>
          {/each}
        </ul>
      {/if}
      {#if section.subsections}
        {#each section.subsections as subsection}
          <h3>{subsection.title}</h3>
          {#if subsection.paragraphs}
            {#each subsection.paragraphs as paragraph}
              <p>{@html paragraph}</p>
            {/each}
          {/if}
          {#if subsection.items}
            <ul>
              {#each subsection.items as item}
                <li>{@html item}</li>
              {/each}
            </ul>
          {/if}
        {/each}
      {/if}
    {/each}
  </article>
</div>

<style>
  .prose {
    color: var(--foreground);
  }

  .prose h1 {
    font-size: 2.25rem;
    font-weight: 700;
    margin-bottom: 1rem;
    color: var(--foreground);
  }

  .prose h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 1rem;
    color: var(--foreground);
  }

  .prose h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: var(--foreground);
  }

  .prose p {
    margin-bottom: 1rem;
    line-height: 1.75;
    color: var(--muted-foreground);
  }

  .prose .lead {
    font-size: 1.125rem;
    color: var(--muted-foreground);
  }

  .prose ul {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
    list-style-type: disc;
  }

  .prose li {
    margin-bottom: 0.5rem;
    line-height: 1.75;
    color: var(--muted-foreground);
  }

  .prose :global(a) {
    color: var(--primary);
    text-decoration: none;
  }

  .prose :global(a:hover) {
    text-decoration: underline;
  }
</style>
