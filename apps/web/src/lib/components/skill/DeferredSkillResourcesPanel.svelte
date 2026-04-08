<script lang="ts">
  import { onMount } from 'svelte';
  import type { FileNode, SkillDetail } from '$lib/types';

  interface SkillResourcesCopy {
    resources: string;
    loadingFile: string;
    binaryFile: string;
    binaryFileHint: string;
  }

  type SkillResourcesPanelComponent =
    typeof import('$lib/components/skill/SkillResourcesPanel.svelte').default;

  interface Props {
    skill: SkillDetail;
    files: FileNode[];
    copy: SkillResourcesCopy;
    requestedFilePath?: string;
    requestedFilePathVersion?: number;
  }

  let {
    skill,
    files,
    copy,
    requestedFilePath = '',
    requestedFilePathVersion = 0,
  }: Props = $props();

  let ResourcesPanelComponent = $state<SkillResourcesPanelComponent | null>(null);
  let container = $state<HTMLDivElement | null>(null);
  let loadingPromise: Promise<void> | null = null;

  const previewCount = $derived(files.length);

  async function loadPanel(): Promise<void> {
    if (ResourcesPanelComponent) {
      return;
    }

    if (loadingPromise) {
      await loadingPromise;
      return;
    }

    loadingPromise = (async () => {
      try {
        const module = await import('$lib/components/skill/SkillResourcesPanel.svelte');
        ResourcesPanelComponent = module.default;
      } catch (error) {
        console.error('Failed to load skill resources panel:', error);
      } finally {
        loadingPromise = null;
      }
    })();

    await loadingPromise;
  }

  $effect(() => {
    requestedFilePathVersion;
    if (!requestedFilePath) return;
    void loadPanel();
  });

  onMount(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId = 0;
    let observer: IntersectionObserver | null = null;

    const preload = () => {
      void loadPanel();
    };

    if (container && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          preload();
          observer?.disconnect();
          observer = null;
        }
      }, { rootMargin: '240px 0px' });

      observer.observe(container);
    }

    if ('requestIdleCallback' in window) {
      idleId = (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
          cancelIdleCallback?: (id: number) => void;
        }
      ).requestIdleCallback(preload, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(preload, 1600);
    }

    return () => {
      observer?.disconnect();
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (idleId && 'cancelIdleCallback' in window) {
        (
          window as Window & {
            cancelIdleCallback?: (id: number) => void;
          }
        ).cancelIdleCallback?.(idleId);
      }
    };
  });
</script>

{#if ResourcesPanelComponent}
  <ResourcesPanelComponent
    {skill}
    {files}
    {copy}
    {requestedFilePath}
    {requestedFilePathVersion}
  />
{:else}
  <div
    bind:this={container}
    class="card resources-shell"
    aria-busy="true"
  >
    <div class="resources-shell-header">
      <h2 class="text-lg font-semibold text-fg">{copy.resources}</h2>
      <span class="resources-shell-count">{previewCount}</span>
    </div>

    <div class="resources-shell-list" aria-hidden="true">
      <div class="resources-shell-row resources-shell-row-wide"></div>
      <div class="resources-shell-row"></div>
      <div class="resources-shell-row resources-shell-row-narrow"></div>
    </div>
  </div>
{/if}

<style>
  .resources-shell {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .resources-shell-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .resources-shell-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.625rem;
    border-radius: 999px;
    background: var(--bg-muted);
    color: var(--fg-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .resources-shell-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
  }

  .resources-shell-row {
    height: 0.875rem;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--bg-muted), var(--card), var(--bg-muted));
    background-size: 200% 100%;
    animation: resources-loading 1.4s ease-in-out infinite;
  }

  .resources-shell-row-wide {
    width: 100%;
  }

  .resources-shell-row:not(.resources-shell-row-wide):not(.resources-shell-row-narrow) {
    width: 72%;
  }

  .resources-shell-row-narrow {
    width: 48%;
  }

  @keyframes resources-loading {
    0% {
      background-position: 100% 50%;
    }

    100% {
      background-position: 0 50%;
    }
  }
</style>
