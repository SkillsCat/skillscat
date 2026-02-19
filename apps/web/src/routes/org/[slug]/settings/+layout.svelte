<script lang="ts">
  import { tick } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth-client';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import {
    SparklesIcon,
    UserMultiple02Icon,
    Key01Icon,
    Settings02Icon,
  } from '@hugeicons/core-free-icons';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  const session = useSession();

  interface Org {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    avatarUrl: string;
    userRole: string | null;
  }

  let org = $state<Org | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const slug = $derived($page.params.slug);

  // Auth guard - redirect to home if not authenticated
  $effect(() => {
    if (!$session.isPending && !$session.data?.user) {
      goto('/');
    }
  });

  // Load org data
  $effect(() => {
    if (slug && $session.data?.user) {
      loadOrg();
    }
  });

  async function loadOrg() {
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/orgs/${slug}`);
      if (res.ok) {
        const data = await res.json() as { organization?: Org };
        org = data.organization ?? null;
        // Check if user has access
        if (org && !org.userRole) {
          goto(`/org/${slug}`);
        } else if (org && !['owner', 'admin'].includes(org.userRole!)) {
          goto(`/org/${slug}`);
        }
      } else {
        error = 'Organization not found';
      }
    } catch {
      error = 'Failed to load organization';
    } finally {
      loading = false;
    }
  }

  const navItems = $derived([
    { href: `/org/${slug}/settings/skills`, label: 'Skills', icon: SparklesIcon },
    { href: `/org/${slug}/settings/members`, label: 'Members', icon: UserMultiple02Icon },
    { href: `/org/${slug}/settings/tokens`, label: 'API Tokens', icon: Key01Icon },
    { href: `/org/${slug}/settings`, label: 'Profile', icon: Settings02Icon, exact: true },
  ]);

  function isActive(href: string, exact = false): boolean {
    if (exact) {
      return $page.url.pathname === href;
    }
    return $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
  }

  let navEl = $state<HTMLElement>();

  // Scroll active tab into view on mobile
  $effect(() => {
    $page.url.pathname;
    tick().then(() => {
      if (!navEl) return;
      const active = navEl.querySelector('.nav-item-active') as HTMLElement | null;
      if (active) {
        navEl.scrollLeft = active.offsetLeft - navEl.offsetWidth / 2 + active.offsetWidth / 2;
      }
    });
  });
</script>

<svelte:head>
  <title>{org?.displayName || slug} Settings - SkillsCat</title>
  <meta name="robots" content="noindex, nofollow, noarchive" />
</svelte:head>

{#if $session.isPending || loading}
  <div class="settings-loading">
    <div class="loading-spinner"></div>
  </div>
{:else if error}
  <div class="settings-error">
    <p>{error}</p>
  </div>
{:else if org}
  <div class="settings-layout">
    <aside class="settings-sidebar">
      <!-- Org Header -->
      <a href="/org/{slug}" class="org-header">
        <Avatar
          src={org.avatarUrl}
          alt={org.displayName || org.name}
          fallback={org.slug}
          size="sm"
        />
        <div class="org-info">
          <span class="org-name">{org.displayName || org.name}</span>
          <span class="org-slug">@{org.slug}</span>
        </div>
      </a>

      <h2 class="sidebar-title">Settings</h2>
      <nav class="sidebar-nav" bind:this={navEl}>
        {#each navItems as item}
          <a
            href={item.href}
            class="nav-item"
            class:nav-item-active={isActive(item.href, item.exact)}
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
  .settings-loading,
  .settings-error {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 8rem);
  }

  .settings-error {
    color: var(--destructive);
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

  .org-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    margin-bottom: 1.5rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s ease;
  }

  .org-header:hover {
    border-color: var(--primary);
  }

  .org-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .org-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .org-slug {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .sidebar-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
    padding-left: 0.5rem;
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
    overflow-x: hidden;
  }

  @media (max-width: 768px) {
    .settings-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 1rem;
      padding: 1rem;
    }

    .settings-sidebar {
      position: static;
      overflow: hidden;
    }

    .org-header {
      display: none;
    }

    .sidebar-title {
      display: none;
    }

    .sidebar-nav {
      flex-direction: row;
      flex-wrap: nowrap;
      gap: 0.375rem;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 2px;
    }

    .sidebar-nav::-webkit-scrollbar {
      display: none;
    }

    .nav-item {
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      white-space: nowrap;
      flex-shrink: 0;
    }
  }
</style>
