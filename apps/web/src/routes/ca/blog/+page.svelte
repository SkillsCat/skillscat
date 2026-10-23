<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import CatalanEditorialShell from '$lib/components/editorial/CatalanEditorialShell.svelte';
  import { catalanArticles } from '$lib/content/catalan-blog';

  const title = 'Blog en català — SkillsCat';
  const description = 'Guies pràctiques en català per revisar i instal·lar skills, localitzar fluxos de treball i compartir les teves pròpies eines.';
</script>

<SEO {title} {description} url="/ca/blog" />
<CatalanEditorialShell eyebrow="Aprendre i compartir" title="Skills, pas a pas i en català" {description}>
  <section class="article-grid" aria-label="Tutorials en català">
    {#each catalanArticles as article}
      <article class="card article-card">
        <p class="category">{article.category}</p>
        <h2><a href={`/ca/blog/${article.slug}`}>{article.title}</a></h2>
        <p>{article.description}</p>
        <span class="read-label" aria-hidden="true">Llegeix la guia →</span>
      </article>
    {/each}
  </section>
  <aside class="review-note">
    <h2>Un recurs obert a correccions</h2>
    <p>Aquestes guies són recursos propis de SkillsCat. La revisió lingüística per persones catalanoparlants està pendent; si hi trobes un error, <a href="https://github.com/skillscat/skillscat/issues/new?title=%5Bca%5D%20Correcci%C3%B3%20del%20blog">proposa una correcció a GitHub</a>. No tradueixen ni validen automàticament els skills de tercers.</p>
  </aside>
</CatalanEditorialShell>

<style>
  .article-grid { display: grid; gap: 1.25rem; }
  .article-card { padding: 1.75rem; border-radius: 1.5rem; }
  .category { color: var(--primary); font-size: 0.8rem; font-weight: 800; margin-bottom: 0.75rem; }
  h2 { font-size: 1.35rem; font-weight: 750; line-height: 1.4; }
  h2 a { text-decoration: underline; text-underline-offset: 0.2em; }
  .article-card > p:not(.category) { margin-top: 0.75rem; color: var(--fg-muted); line-height: 1.7; }
  .read-label { display: block; margin-top: 1.25rem; color: var(--primary); font-weight: 700; }
  .review-note { margin-top: 2rem; padding: 0.5rem; line-height: 1.7; }
  .review-note h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
  .review-note a { color: var(--primary); text-decoration: underline; }
  a:focus-visible { outline: 3px solid var(--primary); outline-offset: 4px; }
  @media (min-width: 48rem) { .article-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
