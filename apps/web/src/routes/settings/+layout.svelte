<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth-client';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import {
    SparklesIcon,
    Building06Icon,
    Key01Icon,
    UserCircleIcon,
  } from '@hugeicons/core-free-icons';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  const session = useSession();

  // Auth guard - redirect to home if not authenticated
  $effect(() => {
    if (!$session.isPending && !$session.data?.user) {
      goto('/');
    }
  });

  const navItems = [
    { href: '/settings/skills', label: 'Skills', icon: SparklesIcon },
    { href: '/settings/organizations', label: 'Organizations', icon: Building06Icon },
    { href: '/settings/tokens', label: 'API Tokens', icon: Key01Icon },
    { href: '/settings/account', label: 'Account', icon: UserCircleIcon },
  ];

  function isActive(href: string): boolean {
    return $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
  }
</script>

<svelte:head>
  <title>Settings - SkillsCat</title>
</svelte:head>

{#if $session.isPending}
  <div class="settings-loading">
    <div class="loading-spinner"></div>
  </div>
{:else if $session.data?.user}
  <div class="settings-layout">
    <aside class="settings-sidebar">
      <h2 class="sidebar-title">Settings</h2>
      <nav class="sidebar-nav">
        {#each navItems as item}
          <a
            href={item.href}
            class="nav-item"
            class:nav-item-active={isActive(item.href)}
          >
            <HugeiconsIcon icon={item.icon} size={18} />
            {item.label}
          </a>
        {/each}
      </nav>
    </aside>
    <main class="settings-content">
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .settings-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 8rem);
  }

  .loading-spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .settings-layout {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1rem;
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 2rem;
  }

  .settings-sidebar {
    position: sticky;
    top: 6rem;
    height: fit-content;
  }

  .sidebar-title {
    font-size: 1.25rem;
    font-weight: 700;
    margin-bottom: 1rem;
    color: var(--foreground);
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--muted-foreground);
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: all 0.15s ease;
  }

  .nav-item:hover {
    color: var(--foreground);
    background: var(--muted);
  }

  .nav-item-active {
    color: var(--primary);
    background: var(--primary-subtle);
  }

  .nav-item-active:hover {
    color: var(--primary);
    background: var(--primary-subtle);
  }

  .settings-content {
    min-width: 0;
  }

  @media (max-width: 768px) {
    .settings-layout {
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }

    .settings-sidebar {
      position: static;
    }

    .sidebar-nav {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .nav-item {
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
    }
  }
</style>
