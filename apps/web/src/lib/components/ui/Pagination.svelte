<script lang="ts">
  /**
   * Pagination - Cute style pagination component
   * Features: page numbers, prev/next arrows, goto input
   */
  import { goto } from '$app/navigation';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    baseUrl: string;
  }

  let { currentPage, totalPages, totalItems, itemsPerPage, baseUrl }: Props = $props();

  let gotoInput = $state('');

  // Generate page numbers to display (max 7 buttons with ellipsis)
  const pageNumbers = $derived.by(() => {
    const pages: (number | 'ellipsis')[] = [];

    if (totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage <= 3) {
        // Near start: 1 2 3 4 5 ... last
        pages.push(2, 3, 4, 5, 'ellipsis', totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Near end: 1 ... n-4 n-3 n-2 n-1 n
        pages.push('ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        // Middle: 1 ... p-1 p p+1 ... last
        pages.push('ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages);
      }
    }

    return pages;
  });

  function getPageUrl(page: number): string {
    if (page === 1) {
      return baseUrl;
    }
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}page=${page}`;
  }

  function navigateToPage(page: number) {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      goto(getPageUrl(page));
    }
  }

  function handleGoto() {
    const page = parseInt(gotoInput, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      navigateToPage(page);
      gotoInput = '';
    }
  }

  function handleGotoKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleGoto();
    }
  }

  // Calculate showing range
  const startItem = $derived((currentPage - 1) * itemsPerPage + 1);
  const endItem = $derived(Math.min(currentPage * itemsPerPage, totalItems));
</script>

{#if totalPages > 1}
  <nav class="pagination" aria-label="Pagination">
    <!-- Info text -->
    <div class="pagination-info">
      Showing {startItem}-{endItem} of {totalItems}
    </div>

    <div class="pagination-controls">
      <!-- Previous button -->
      <button
        class="pagination-btn pagination-arrow"
        onclick={() => navigateToPage(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
        <span class="hidden sm:inline">Prev</span>
      </button>

      <!-- Page numbers -->
      <div class="pagination-pages">
        {#each pageNumbers as page}
          {#if page === 'ellipsis'}
            <span class="pagination-ellipsis">...</span>
          {:else}
            <button
              class="pagination-btn pagination-page"
              class:active={page === currentPage}
              onclick={() => navigateToPage(page)}
              aria-label="Page {page}"
              aria-current={page === currentPage ? 'page' : undefined}
            >
              {page}
            </button>
          {/if}
        {/each}
      </div>

      <!-- Next button -->
      <button
        class="pagination-btn pagination-arrow"
        onclick={() => navigateToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Next page"
      >
        <span class="hidden sm:inline">Next</span>
        <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
      </button>

      <!-- Goto input -->
      <div class="pagination-goto">
        <input
          type="number"
          min="1"
          max={totalPages}
          placeholder="Go to"
          bind:value={gotoInput}
          onkeydown={handleGotoKeydown}
          class="pagination-goto-input"
          aria-label="Go to page"
        />
        <button
          class="pagination-goto-btn"
          onclick={handleGoto}
          aria-label="Go"
        >
          Go
        </button>
      </div>
    </div>
  </nav>
{/if}

<style>
  .pagination {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 2px solid var(--border);
  }

  .pagination-info {
    font-size: 0.875rem;
    color: var(--fg-muted);
  }

  .pagination-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .pagination-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    font-family: var(--font-sans);
    color: var(--fg);
    background: var(--bg-subtle);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.15s ease;
    min-width: 2.5rem;
    min-height: 2.5rem;
  }

  .pagination-btn:hover:not(:disabled) {
    background: var(--bg-muted);
    border-color: var(--primary);
    color: var(--primary);
  }

  .pagination-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .pagination-arrow {
    padding: 0.5rem 1rem;
  }

  .pagination-page {
    min-width: 2.5rem;
    padding: 0.5rem;
  }

  .pagination-page.active {
    --btn-shadow-offset: 3px;
    --btn-shadow-color: oklch(50% 0.22 55);

    background: var(--primary);
    color: #ffffff;
    border-color: var(--primary);
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
    transform: translateY(-1px);
  }

  :global(:root.dark) .pagination-page.active {
    --btn-shadow-color: oklch(40% 0.20 55);
  }

  .pagination-pages {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .pagination-ellipsis {
    padding: 0 0.5rem;
    color: var(--fg-muted);
    font-weight: 600;
  }

  .pagination-goto {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: 0.5rem;
  }

  .pagination-goto-input {
    width: 4rem;
    padding: 0.5rem 0.5rem;
    font-size: 0.875rem;
    font-family: var(--font-sans);
    color: var(--fg);
    background: var(--bg-subtle);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    outline: none;
    text-align: center;
    min-height: 2.5rem;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .pagination-goto-input::-webkit-outer-spin-button,
  .pagination-goto-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .pagination-goto-input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }

  .pagination-goto-input::placeholder {
    color: var(--fg-subtle);
  }

  .pagination-goto-btn {
    --btn-shadow-offset: 3px;
    --btn-shadow-color: oklch(50% 0.22 55);

    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    font-family: var(--font-sans);
    color: #ffffff;
    background: var(--primary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
    transition: all 0.1s ease;
    min-height: 2.5rem;
  }

  .pagination-goto-btn:hover {
    --btn-shadow-offset: 4px;
    transform: translateY(-1px);
    background: var(--primary-hover);
  }

  .pagination-goto-btn:active {
    --btn-shadow-offset: 1px;
    transform: translateY(2px);
  }

  :global(:root.dark) .pagination-goto-btn {
    --btn-shadow-color: oklch(40% 0.20 55);
  }

  /* Responsive */
  @media (max-width: 640px) {
    .pagination-controls {
      gap: 0.375rem;
    }

    .pagination-arrow {
      padding: 0.5rem;
    }

    .pagination-page {
      min-width: 2.25rem;
      padding: 0.375rem;
      font-size: 0.8125rem;
    }

    .pagination-goto {
      margin-left: 0.25rem;
    }

    .pagination-goto-input {
      width: 3.5rem;
      padding: 0.375rem;
    }
  }
</style>
