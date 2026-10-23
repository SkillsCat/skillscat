<script lang="ts">
  import type { PageData } from './$types';
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import CatalanEditorialShell from '$lib/components/editorial/CatalanEditorialShell.svelte';
  let { data }: { data: PageData } = $props();
  const article = $derived(data.article);
  const structuredData = $derived({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: article.title,
    description: article.description,
    inLanguage: 'ca',
    url: `https://skills.cat/ca/blog/${article.slug}`,
  });
</script>

<SEO title={`${article.title} — SkillsCat`} description={article.description} url={`/ca/blog/${article.slug}`} type="article" {structuredData} />
<CatalanEditorialShell eyebrow={article.category} title={article.title} description={article.description}>
  <nav class="article-toc" aria-label="Contingut de l’article">
    <h2>En aquesta guia</h2>
    <ol>
      {#each article.sections as section}
        <li><a href={`#${section.id}`}>{section.title}</a></li>
      {/each}
    </ol>
  </nav>
  <DocsProseCard title="Guia pràctica · Català">
    {#each article.sections as section}
      <h2 id={section.id}>{section.title}</h2>
      {#each section.paragraphs as paragraph}<p>{paragraph}</p>{/each}
      {#if section.code}<pre><code>{section.code}</code></pre>{/if}
      {#if section.items}
        <ul>{#each section.items as item}<li>{item}</li>{/each}</ul>
      {/if}
    {/each}
    <h2>Continua aprenent</h2>
    <p><a href="/ca/docs/cli">Consulta la guia de la CLI</a> o <a href="/ca/blog">torna als tutorials en català</a>.</p>
    <p>Revisió lingüística per persones catalanoparlants pendent. <a href={`https://github.com/skillscat/skillscat/issues/new?title=${encodeURIComponent(`[ca] Correcció: ${article.title}`)}`}>Proposa una correcció</a> amb l’URL i el fragment afectat. No incloguis credencials ni dades privades.</p>
  </DocsProseCard>
</CatalanEditorialShell>

<style>
  .article-toc { padding: 0 0.5rem 2rem; line-height: 1.7; }
  .article-toc h2 { font-weight: 750; margin-bottom: 0.5rem; }
  .article-toc ol { display: grid; gap: 0.5rem; }
  .article-toc a { color: var(--primary); text-decoration: underline; text-underline-offset: 0.15em; }
  .article-toc a:focus-visible { outline: 3px solid var(--primary); outline-offset: 4px; }
</style>
