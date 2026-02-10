<script lang="ts">
  import { browser } from '$app/environment';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Sun02Icon, Moon02Icon } from '@hugeicons/core-free-icons';

  let isDark = $state(false);

  function toggleTheme() {
    isDark = !isDark;
    if (browser) {
      document.documentElement.classList.toggle('dark', isDark);
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }
  }

  // Initialize theme on mount
  $effect(() => {
    if (browser) {
      const saved = localStorage.getItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      isDark = saved === 'dark' || (!saved && prefersDark);
      document.documentElement.classList.toggle('dark', isDark);
    }
  });
</script>

<button
  onclick={toggleTheme}
  class="theme-toggle"
  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
>
  <span class="icon-wrapper" class:rotate={isDark}>
    {#if isDark}
      <HugeiconsIcon icon={Sun02Icon} size={18} strokeWidth={2} />
    {:else}
      <HugeiconsIcon icon={Moon02Icon} size={18} strokeWidth={2} />
    {/if}
  </span>
</button>

<style>
  .theme-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.625rem;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    color: var(--foreground);
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .theme-toggle:hover {
    border-color: var(--primary);
    color: var(--primary);
    transform: scale(1.1);
  }

  .icon-wrapper {
    display: flex;
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .icon-wrapper.rotate {
    transform: rotate(180deg);
  }
</style>
