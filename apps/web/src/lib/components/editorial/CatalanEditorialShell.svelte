<script lang="ts">
  import type { Snippet } from 'svelte';
  let { eyebrow, title, description, children }: {
    eyebrow: string;
    title: string;
    description: string;
    children: Snippet;
  } = $props();
</script>

<div class="editorial-shell" lang="ca">
  <header class="card editorial-hero">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p class="description">{description}</p>
  </header>
  {@render children()}
</div>

<style>
  .editorial-shell { max-width: 64rem; margin: 0 auto; padding: 2.5rem 1rem; }
  .editorial-hero { padding: clamp(1.5rem, 4vw, 3rem); border-radius: 1.75rem; margin-bottom: 2rem; }
  .eyebrow { color: var(--primary); font-weight: 800; font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 0.75rem; }
  h1 { font-size: clamp(2rem, 5vw, 3.25rem); font-weight: 800; line-height: 1.15; text-wrap: balance; overflow-wrap: anywhere; }
  .description { margin-top: 1.25rem; max-width: 48rem; font-size: 1.05rem; color: var(--fg-muted); line-height: 1.7; }
</style>
