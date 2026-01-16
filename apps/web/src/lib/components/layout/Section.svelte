<script lang="ts">
  import type { Snippet } from 'svelte';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { ArrowRight01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    title: string;
    href?: string;
    children: Snippet;
    class?: string;
    icon?: Snippet;
  }

  let { title, href, children, class: className = '', icon }: Props = $props();
</script>

<section class="mb-12 {className}">
  <div class="flex items-center justify-between mb-6">
    <h2 class="section-title">
      {#if icon}
        <span class="section-icon">
          {@render icon()}
        </span>
      {/if}
      {title}
    </h2>
    {#if href}
      <a {href} class="view-all-link">
        View all
        <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
      </a>
    {/if}
  </div>
  {@render children()}
</section>

<style>
  .section-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--foreground);
  }

  .section-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-lg);
    color: var(--primary);
    transition: all 0.2s ease;
  }

  .section-title:hover .section-icon {
    transform: rotate(-5deg) scale(1.05);
    background: var(--primary);
    color: var(--primary-foreground);
  }

  .view-all-link {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--primary);
    text-decoration: none;
    padding: 0.5rem 0.875rem;
    background: var(--primary-subtle);
    border-radius: var(--radius-full);
    transition: all 0.2s ease;
  }

  .view-all-link:hover {
    background: var(--primary);
    color: var(--primary-foreground);
    transform: translateX(2px);
  }
</style>
