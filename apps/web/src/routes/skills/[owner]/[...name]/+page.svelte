<script lang="ts">
  import { tick, untrack } from 'svelte';
  import SEO from '$lib/components/common/SEO.svelte';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import DeferredSkillResourcesPanel from '$lib/components/skill/DeferredSkillResourcesPanel.svelte';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';
  import { toast } from '$lib/components/ui/toast-store';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import VisibilityBadge from '$lib/components/ui/VisibilityBadge.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { getSkillPageCopy } from '$lib/i18n/skill-page';
  import { formatRelativeTimestamp } from '$lib/i18n/relative';
  import { getLocalizedCategoryBySlug } from '$lib/i18n/categories';
  import { splitShellCommand } from '$lib/skill-install';
  import { encodeSkillSlugForPath } from '$lib/skill-path';
  import { ensureClientShikiLanguage, getClientShikiHighlighter } from '$lib/shiki-client';
  import { useSession } from '$lib/auth-client';
  import type {
    SkillDetail,
    SkillCardData,
    FileNode,
    SkillInstallData,
    SecurityDimension,
    SecurityRiskLevel,
  } from '$lib/types';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  type SkillPageErrorKind = 'not_found' | 'temporary_failure';

  interface Props {
    data: {
      skill: SkillDetail | null;
      install?: SkillInstallData;
      recommendSkills: SkillCardData[];
      deferRecommendSkills?: boolean;
      error?: string;
      errorKind?: SkillPageErrorKind;
      isOwner?: boolean;
      isBookmarked?: boolean;
      isAuthenticated?: boolean;
      deferUserState?: boolean;
      trackPublicAccessClientSide?: boolean;
      isDotFolderSkill?: boolean;
      hasReadme?: boolean;
      renderedReadme?: string;
      seo?: {
        title: string;
        description: string;
        keywords: string[];
        articleTags?: string[];
        section?: string;
      };
    };
  }

  let { data }: Props = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const copy = $derived(getSkillPageCopy(i18n.locale()));
  const session = useSession();
  const securitySummary = $derived(data.skill?.security ?? null);

  const securityRiskOrder: Record<SecurityRiskLevel, number> = {
    low: 1,
    mid: 2,
    high: 3,
    fatal: 4,
  };

  function pickHighestRisk(...levels: Array<SecurityRiskLevel | null | undefined>): SecurityRiskLevel {
    let highest: SecurityRiskLevel = 'low';
    for (const level of levels) {
      if (!level) continue;
      if (securityRiskOrder[level] > securityRiskOrder[highest]) {
        highest = level;
      }
    }
    return highest;
  }

  function formatRiskLabel(level: SecurityRiskLevel | null | undefined): string {
    if (!level) return copy.securityRiskUnknown;
    if (level === 'low') return copy.securityRiskLow;
    if (level === 'mid') return copy.securityRiskMid;
    if (level === 'high') return copy.securityRiskHigh;
    return copy.securityRiskFatal;
  }

  function formatSecurityDimensionLabel(dimension: SecurityDimension): string {
    if (dimension === 'prompt_injection') return copy.securityDimensionPromptInjection;
    if (dimension === 'privacy_exfiltration') return copy.securityDimensionPrivacyExfiltration;
    if (dimension === 'dangerous_operations') return copy.securityDimensionDangerousOperations;
    if (dimension === 'supply_chain_malware') return copy.securityDimensionSupplyChainMalware;
    return copy.securityDimensionObfuscationEvasion;
  }

  function getRiskLevelFromScore(score: number): SecurityRiskLevel {
    if (score >= 9) return 'fatal';
    if (score >= 7) return 'high';
    if (score >= 3) return 'mid';
    return 'low';
  }

  const securityVisualRisk = $derived.by(() => pickHighestRisk(
    securitySummary?.aiRiskLevel,
    securitySummary?.vtRiskLevel
  ));
  const securityAiLabel = $derived.by(() => formatRiskLabel(securitySummary?.aiRiskLevel));
  const securityVtLabel = $derived.by(() => formatRiskLabel(securitySummary?.vtRiskLevel));
  const shouldShowSecurityReasons = $derived.by(() => {
    const aiRiskLevel = securitySummary?.aiRiskLevel;
    return aiRiskLevel === 'mid' || aiRiskLevel === 'high' || aiRiskLevel === 'fatal';
  });
  const securityNarrative = $derived.by(() => {
    const summary = securitySummary?.aiSummary?.trim();
    if (!summary) return '';
    if (/^heuristic indicators ->/i.test(summary)) return '';
    if (/^heuristics found no strong indicators/i.test(summary)) return '';
    return summary;
  });
  const securityFindings = $derived.by(() => (
    [...(securitySummary?.aiFindings ?? [])]
      .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
      .slice(0, 3)
  ));
  const securityDimensions = $derived.by(() => (
    [...(securitySummary?.aiDimensions ?? [])]
      .filter((entry) => entry.score >= 3)
      .sort((left, right) => right.score - left.score || left.dimension.localeCompare(right.dimension))
      .slice(0, 3)
  ));

  // Bookmark state - use local state that syncs with server data
  let bookmarkOverride = $state<boolean | null>(null);
  let bookmarkState = $state<{ isAuthenticated: boolean; isBookmarked: boolean } | null>(null);
  let isBookmarking = $state(false);
  let isLoadingBookmarkState = $state(false);
  const shouldDeferUserState = $derived(Boolean(data.deferUserState && data.skill?.visibility === 'public'));
  const bookmarkUiPending = $derived.by(() => {
    if (!shouldDeferUserState) {
      return false;
    }

    if ($session.isPending) {
      return true;
    }

    return Boolean($session.data?.user) && isLoadingBookmarkState && !bookmarkState && bookmarkOverride === null;
  });
  const isAuthenticated = $derived.by(() => {
    if (bookmarkState) {
      return bookmarkState.isAuthenticated;
    }

    if (!shouldDeferUserState) {
      return data.isAuthenticated ?? false;
    }

    if ($session.isPending) {
      return false;
    }

    return Boolean($session.data?.user);
  });
  const isBookmarked = $derived(bookmarkOverride ?? bookmarkState?.isBookmarked ?? data.isBookmarked ?? false);
  const canUseNativeShare = $derived(
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  );
  let shareMenuOpen = $state(false);
  let shareMenuRoot = $state<HTMLDivElement | null>(null);
  let shareMenuTrigger = $state<HTMLButtonElement | null>(null);
  let shareMenuCloseTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

  $effect(() => {
    data.skill?.id;
    bookmarkOverride = null;
    bookmarkState = null;
    isLoadingBookmarkState = false;
    requestedResourceFilePath = '';
    cancelShareMenuClose();
    shareMenuOpen = false;
  });

  $effect(() => {
    const skillId = data.skill?.id;
    if (!skillId || !shouldDeferUserState) {
      return;
    }

    if ($session.isPending) {
      return;
    }

    if (!$session.data?.user) {
      bookmarkState = {
        isAuthenticated: false,
        isBookmarked: false,
      };
      return;
    }

    const controller = new AbortController();
    isLoadingBookmarkState = true;

    void (async () => {
      try {
        const response = await fetch(`/api/favorites/state?skillId=${encodeURIComponent(skillId)}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' }
        });

        if (response.status === 401) {
          bookmarkState = {
            isAuthenticated: false,
            isBookmarked: false,
          };
          return;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json() as {
          isAuthenticated?: boolean;
          isBookmarked?: boolean;
        };

        bookmarkState = {
          isAuthenticated: Boolean(payload.isAuthenticated),
          isBookmarked: Boolean(payload.isBookmarked),
        };
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Failed to load bookmark state:', err);
        bookmarkState = {
          isAuthenticated: true,
          isBookmarked: false,
        };
      } finally {
        if (!controller.signal.aborted) {
          isLoadingBookmarkState = false;
        }
      }
    })();

    return () => controller.abort();
  });

  $effect(() => {
    const skillId = data.skill?.id;
    if (!skillId || !data.trackPublicAccessClientSide || typeof window === 'undefined') {
      return;
    }

    void fetch('/api/skills/access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ skillId }),
      keepalive: true,
    }).catch((err) => {
      console.error('Failed to record public skill access:', err);
    });
  });

  async function handleBookmark() {
    if (!data.skill || isBookmarking) return;
    isBookmarking = true;

    try {
      const currentState = isBookmarked;
      const method = currentState ? 'DELETE' : 'POST';
      const response = await fetch('/api/favorites', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: data.skill.id })
      });

      if (response.ok) {
        bookmarkOverride = !currentState;
        bookmarkState = {
          isAuthenticated: true,
          isBookmarked: !currentState,
        };
        toast(
          !currentState ? copy.bookmarkAdded : copy.bookmarkRemoved,
          'success'
        );
      } else {
        toast(copy.bookmarkFailed, 'error');
      }
    } catch (err) {
      console.error('Bookmark failed:', err);
      toast(copy.bookmarkFailed, 'error');
    } finally {
      isBookmarking = false;
    }
  }

  async function handleNativeShare() {
    if (!data.skill || !canUseNativeShare) return;

    try {
      await navigator.share({
        title: `${data.skill.name} - SkillsCat`,
        text: i18n.t(copy.shareText, { name: data.skill.name }),
        url: canonicalSkillUrl
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name?: string }).name === 'AbortError'
      ) {
        return;
      }
      console.error('Native share failed:', err);
      toast(copy.shareFailed, 'error');
    }
  }

  function handleShareToX() {
    if (!data.skill || typeof window === 'undefined') return;

    const shareUrl = new URL('https://x.com/intent/tweet');
    shareUrl.searchParams.set('text', i18n.t(copy.shareText, { name: data.skill.name }));
    shareUrl.searchParams.set('url', canonicalSkillUrl);
    window.open(shareUrl.toString(), '_blank', 'noopener,noreferrer');
  }

  async function handleCopyUrl() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      toast(copy.clipboardUnavailable, 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(canonicalSkillUrl);
      toast(copy.urlCopied, 'success');
    } catch (err) {
      console.error('Copy URL failed:', err);
      toast(copy.copyFailed, 'error');
    }
  }

  function getShareMenuItems(): HTMLButtonElement[] {
    if (!shareMenuRoot) return [];
    return Array.from(shareMenuRoot.querySelectorAll<HTMLButtonElement>('.share-dropdown-item'));
  }

  function cancelShareMenuClose() {
    if (!shareMenuCloseTimeout) return;
    clearTimeout(shareMenuCloseTimeout);
    shareMenuCloseTimeout = null;
  }

  function scheduleShareMenuClose(options?: { restoreFocus?: boolean }) {
    cancelShareMenuClose();
    shareMenuCloseTimeout = setTimeout(() => {
      shareMenuCloseTimeout = null;
      closeShareMenu(options);
    }, 120);
  }

  async function openShareMenu(options?: { focus?: 'first' | 'last' }) {
    cancelShareMenuClose();
    shareMenuOpen = true;
    if (!options?.focus) return;

    await tick();
    const items = getShareMenuItems();
    const nextItem = options.focus === 'last' ? items[items.length - 1] : items[0];
    nextItem?.focus();
  }

  function closeShareMenu(options?: { restoreFocus?: boolean }) {
    cancelShareMenuClose();
    shareMenuOpen = false;
    if (options?.restoreFocus) {
      shareMenuTrigger?.focus();
    }
  }

  async function runShareAction(action: () => void | Promise<void>) {
    closeShareMenu();
    await action();
  }

  function handleShareTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void openShareMenu({ focus: 'first' });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      void openShareMenu({ focus: 'last' });
      return;
    }

    if (event.key === 'Escape' && shareMenuOpen) {
      event.preventDefault();
      closeShareMenu();
    }
  }

  function handleShareMenuKeydown(event: KeyboardEvent) {
    const items = getShareMenuItems();
    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item === document.activeElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeShareMenu({ restoreFocus: true });
    }
  }

  function handleShareRootMouseEnter() {
    void openShareMenu();
  }

  function handleShareRootMouseLeave() {
    scheduleShareMenuClose();
  }

  function handleShareRootFocusIn() {
    void openShareMenu();
  }

  function handleShareRootFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (shareMenuRoot && nextTarget instanceof Node && shareMenuRoot.contains(nextTarget)) {
      cancelShareMenuClose();
      return;
    }
    scheduleShareMenuClose();
  }

  $effect(() => () => {
    cancelShareMenuClose();
  });

  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!shareMenuRoot || !(target instanceof Node)) return;
      if (!shareMenuRoot.contains(target)) {
        closeShareMenu();
      }
    };

    const handleDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeShareMenu();
      }
    };

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeydown);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeydown);
    };
  });

  function retryCurrentPage() {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  // Shiki highlighter (lazy loaded)
  let highlighter = $state<Awaited<ReturnType<typeof getClientShikiHighlighter>> | null>(null);
  let highlightedReadme = $state('');
  let isLoadingShiki = $state(false);
  let activeReadmeHighlightId = 0;
  let lastReadmeHighlightSkillId: string | null = null;
  let lastReadmeHighlightHtml = '';
  let deferredRecommendSkills = $state<SkillCardData[] | null>(null);
  let deferredRecommendSkillsError = $state<string | null>(null);

  // Reset highlighted HTML whenever server-rendered markdown changes.
  $effect(() => {
    const currentSkillId = data.skill?.id ?? null;
    const renderedReadme = data.renderedReadme ?? '';
    if (currentSkillId === lastReadmeHighlightSkillId && renderedReadme === lastReadmeHighlightHtml) return;

    lastReadmeHighlightSkillId = currentSkillId;
    lastReadmeHighlightHtml = renderedReadme;
    activeReadmeHighlightId += 1;
    highlightedReadme = '';
  });

  // For client-side navigations, recommend skills are fetched lazily to keep __data.json fast.
  $effect(() => {
    const skill = data.skill;
    const shouldDefer = Boolean(data.deferRecommendSkills && skill);

    deferredRecommendSkills = null;
    deferredRecommendSkillsError = null;

    if (!shouldDefer || !skill) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const query = new URLSearchParams();
        for (const category of skill.categories.slice(0, 3)) {
          query.append('category', category);
        }

        const recommendEndpoint = `/api/skills/${encodeSkillSlugForPath(skill.slug)}/recommend${query.size > 0 ? `?${query.toString()}` : ''}`;
        const response = await fetch(recommendEndpoint, {
          signal: controller.signal,
          headers: { accept: 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json() as {
          success?: boolean;
          error?: string;
          data?: { recommendSkills?: SkillCardData[] };
        };

        if (!payload.success) {
          throw new Error(payload.error || copy.recommendFailed);
        }

        deferredRecommendSkills = payload.data?.recommendSkills || [];
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Deferred recommend skills load failed:', err);
        deferredRecommendSkillsError = copy.recommendFailed;
        deferredRecommendSkills = [];
      }
    })();

    return () => controller.abort();
  });

  // Lazy-load shiki during idle time so it doesn't compete with first paint.
  $effect(() => {
    if (!data.renderedReadme || highlighter || isLoadingShiki) return;

    const run = () => {
      void loadShiki();
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
        }
      ).requestIdleCallback(run, { timeout: 1200 });
      return;
    }

    setTimeout(run, 250);
  });

  // If shiki is already available (client-side navigation), highlight immediately.
  $effect(() => {
    const renderedReadme = data.renderedReadme;
    if (!highlighter || !renderedReadme || highlightedReadme) return;

    untrack(() => {
      void highlightReadmeHtml(renderedReadme, activeReadmeHighlightId);
    });
  });

  // Handle clicks on relative file links in markdown content
  let requestedResourceFilePath = $state('');
  let requestedResourceFilePathVersion = $state(0);

  $effect(() => {
    function handleFileLinkClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const fileLink = target.closest('.file-link[data-file-path]') as HTMLElement | null;
      if (fileLink) {
        e.preventDefault();
        const filePath = fileLink.dataset.filePath;
        if (filePath) {
          requestedResourceFilePath = filePath;
          requestedResourceFilePathVersion += 1;
        }
      }
    }

    document.addEventListener('click', handleFileLinkClick);
    return () => {
      document.removeEventListener('click', handleFileLinkClick);
    };
  });

  async function loadShiki() {
    if (highlighter || isLoadingShiki) return;
    isLoadingShiki = true;

    try {
      highlighter = await getClientShikiHighlighter();
      const renderedReadme = data.renderedReadme;
      if (renderedReadme) {
        await highlightReadmeHtml(renderedReadme, activeReadmeHighlightId);
      }
    } catch (e) {
      console.error('Failed to load shiki:', e);
    } finally {
      isLoadingShiki = false;
    }
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeCssSelectorValue(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/["\\\]]/g, '\\$&');
  }

  function getCodeLanguage(node: HTMLElement): string {
    const dataLanguage = node.dataset.language?.trim().toLowerCase();
    if (dataLanguage) return dataLanguage;

    for (const className of node.classList) {
      if (className.startsWith('language-')) {
        const fromClass = className.slice('language-'.length).trim().toLowerCase();
        if (fromClass) return fromClass;
      }
    }

    return 'plaintext';
  }

  async function highlightReadmeHtml(renderedReadme: string, highlightId: number) {
    if (!highlighter || !renderedReadme) return;

    const container = document.createElement('div');
    container.innerHTML = renderedReadme;

    const codeBlocks = Array.from(container.querySelectorAll('pre > code')) as HTMLElement[];
    if (codeBlocks.length === 0) {
      if (highlightId === activeReadmeHighlightId) {
        highlightedReadme = renderedReadme;
      }
      return;
    }

    const BATCH_SIZE = 6;

    for (let i = 0; i < codeBlocks.length; i++) {
      const codeBlock = codeBlocks[i];
      const pre = codeBlock.closest('pre');
      if (!pre || !pre.parentNode) continue;

      const language = await ensureClientShikiLanguage(highlighter, getCodeLanguage(codeBlock));
      if (highlightId !== activeReadmeHighlightId) {
        return;
      }

      try {
        const codeHtml = highlighter.codeToHtml(codeBlock.textContent || '', {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' }
        });
        const template = document.createElement('template');
        template.innerHTML = codeHtml.trim();
        const shikiNode = template.content.firstElementChild;
        if (shikiNode) {
          pre.parentNode.replaceChild(shikiNode, pre);
        }
      } catch {
        // Keep server-rendered <pre><code> output if highlighting fails.
      }

      if ((i + 1) % BATCH_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (highlightId !== activeReadmeHighlightId) {
          return;
        }
      }
    }

    if (highlightId === activeReadmeHighlightId) {
      highlightedReadme = container.innerHTML;
    }
  }

  const encodedApiSkillSlug = $derived(data.skill ? encodeURIComponent(data.skill.slug) : '');

  type InstallOption =
    | {
        id: 'skillscat' | 'skills';
        type: 'cli';
        label: string;
        command: string;
        description: string;
      }
    | {
        id: 'agent';
        type: 'agent';
        label: string;
        prompt: string;
        description: string;
      };

  const agentInstallPrompt = $derived(data.install?.agentPrompt || '');
  const installOptions = $derived<InstallOption[]>([
    ...(data.install?.cli || []).map((installer) => ({
      id: installer.id,
      type: 'cli' as const,
      label: installer.id === 'skillscat' ? copy.skillscatCliLabel : copy.skillsCliLabel,
      command: installer.command,
      description: installer.id === 'skillscat'
        ? data.skill?.visibility === 'private'
          ? copy.privateCliDescription
          : copy.registryCliDescription
        : copy.vercelCliDescription
    })),
    ...(agentInstallPrompt
      ? [{
          id: 'agent' as const,
          type: 'agent' as const,
          label: copy.installAgentTab,
          prompt: agentInstallPrompt,
          description: copy.agentInstallDescription
        }]
      : [])
  ]);
  let selectedInstallMethod = $state<'skillscat' | 'skills' | 'agent'>('skillscat');
  const selectedInstallOptionIndex = $derived(
    Math.max(installOptions.findIndex((option) => option.id === selectedInstallMethod), 0)
  );
  const currentInstallOption = $derived(installOptions[selectedInstallOptionIndex] || null);
  const currentCommand = $derived(
    currentInstallOption?.type === 'cli' ? currentInstallOption.command : ''
  );
  const rawAgentPrompt = $derived(
    currentInstallOption?.type === 'agent' ? currentInstallOption.prompt : ''
  );

  $effect(() => {
    if (installOptions.length === 0) return;
    if (!installOptions.some((option) => option.id === selectedInstallMethod)) {
      selectedInstallMethod = installOptions[0].id;
    }
  });

  // Download state
  let isDownloading = $state(false);
  let downloadSuccess = $state(false);

  function trackSuccessfulInstall(): void {
    if (!data.skill) return;

    void fetch(`/api/skills/${encodedApiSkillSlug}/track-install`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {
      // Tracking should not block a successful install UX.
    });
  }

  // Download skill files
  async function handleDownload() {
    if (!data.skill || isDownloading) return;
    isDownloading = true;

    try {
      const { downloadSkill } = await import('$lib/skill-download-client');
      const outcome = await downloadSkill({
        skill: data.skill,
        encodedApiSkillSlug,
        tooManyRequestsMessage: copy.tooManyRequests,
        downloadFailedMessage: copy.downloadFailed,
      });

      if (outcome === 'installed') {
        trackSuccessfulInstall();
        downloadSuccess = true;
        toast(i18n.t(copy.installedSuccess, { name: data.skill.name }), 'success', { celebrate: true });
        setTimeout(() => downloadSuccess = false, 3000);
        return;
      }

      if (outcome === 'rate_limited') {
        toast(copy.tooManyRequests, 'warning');
      }
    } catch (err) {
      console.error('Failed to load download client:', err);
      fallbackDownload();
    } finally {
      isDownloading = false;
    }
  }

  // Fallback to zip download
  function fallbackDownload() {
    if (!data.skill) return;
    window.location.href = `/api/skills/${encodedApiSkillSlug}/download`;
  }

  // Use delayed-highlighted version if available, otherwise server-rendered HTML.
  const renderedReadme = $derived(highlightedReadme || data.renderedReadme || '');

  // Binary file extensions that cannot be previewed
  const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'tar', 'gz', 'rar', '7z',
    'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'webm',
    'exe', 'dll', 'so', 'dylib',
    'woff', 'woff2', 'ttf', 'otf', 'eot'
  ]);

  function isBinaryFile(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return BINARY_EXTENSIONS.has(ext);
  }

  function isSkillReadmeFile(path: string): boolean {
    return path.replace(/^\.\//, '').toLowerCase() === 'skill.md';
  }

  function filterResourceNodes(nodes: FileNode[]): FileNode[] {
    const filtered: FileNode[] = [];

    for (const node of nodes) {
      if (node.type === 'file') {
        if (!isSkillReadmeFile(node.path)) {
          filtered.push(node);
        }
        continue;
      }

      const children = node.children ? filterResourceNodes(node.children) : [];
      if (children.length === 0) continue;
      filtered.push({
        ...node,
        children,
      });
    }

    return filtered;
  }

  const resourceFileStructure = $derived(
    data.skill?.fileStructure ? filterResourceNodes(data.skill.fileStructure) : []
  );

  function formatRelativeTime(timestamp: number): string {
    return formatRelativeTimestamp(i18n, messages, timestamp);
  }

  function formatRecommendAuthor(owner: string): string {
    return i18n.locale() === 'en'
      ? i18n.t(messages.common.byAuthor, { author: owner })
      : owner;
  }

  function formatRecommendStars(stars: number): string {
    return i18n.formatCompactNumber(stars);
  }

  function getRecommendSkillHref(slug: string): string {
    return `/skills/${encodeSkillSlugForPath(slug)}`;
  }

  // Get author profile URL
  function getAuthorProfileUrl(): string {
    if (!data.skill) return '#';
    if (data.skill.orgSlug) return `/org/${data.skill.orgSlug}`;
    if (data.skill.authorUsername) return `/u/${encodeURIComponent(data.skill.authorUsername)}`;
    if (data.skill.ownerName) return `/u/${encodeURIComponent(data.skill.ownerName)}`;
    if (data.skill.repoOwner) return `/u/${encodeURIComponent(data.skill.repoOwner)}`;
    return '#';
  }

  // Get author display name for breadcrumb
  function getAuthorDisplayName(): string {
    if (!data.skill) return '';
    if (data.skill.orgName) return data.skill.orgName;
    if (data.skill.ownerName) return data.skill.ownerName;
    if (data.skill.authorDisplayName) return data.skill.authorDisplayName;
    if (data.skill.authorUsername) return data.skill.authorUsername;
    return data.skill.repoOwner || '';
  }

  // Get author avatar URL
  function getAuthorAvatarUrl(): string {
    if (!data.skill) return '';
    if (data.skill.orgAvatar) return data.skill.orgAvatar;
    if (data.skill.ownerAvatar) return data.skill.ownerAvatar;
    if (data.skill.authorAvatar) return data.skill.authorAvatar;
    return `https://avatars.githubusercontent.com/${data.skill.repoOwner}?s=96`;
  }

  function toIsoTimestamp(timestamp: number | null | undefined): string | undefined {
    if (!timestamp || timestamp <= 0) return undefined;
    return new Date(timestamp).toISOString();
  }

  // Highlight command syntax
  function highlightCommand(command: string): string {
    const parts = splitShellCommand(command);
    const highlighted: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === 'npx') {
        highlighted.push(`<span class="cmd-npx">${escapeHtml(part)}</span>`);
      } else if (part === 'skillscat' || part === 'skills') {
        highlighted.push(`<span class="cmd-tool">${escapeHtml(part)}</span>`);
      } else if (part === 'add' || part === '--skill') {
        highlighted.push(`<span class="cmd-action">${escapeHtml(part)}</span>`);
      } else if (part.includes('/')) {
        // owner/repo format
        highlighted.push(`<span class="cmd-repo">${escapeHtml(part)}</span>`);
      } else {
        highlighted.push(`<span class="cmd-default">${escapeHtml(part)}</span>`);
      }
    }

    return highlighted.join(' ');
  }

  const highlightedCommand = $derived(highlightCommand(currentCommand));
  function highlightAgentPromptText(value: string): string {
    return escapeHtml(value).replace(
      /npx skillscat login/g,
      '<span class="agent-inline-code">npx skillscat login</span>'
    );
  }

  function highlightAgentPrompt(prompt: string): string {
    if (!prompt.trim()) return '';

    return prompt
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return '<div class="agent-spacer" aria-hidden="true"></div>';
        }

        const metaMatch = trimmed.match(/^(Skill|Slug|Repository|Skill page):\s*(.+)$/);
        if (metaMatch) {
          const [, label, value] = metaMatch;
          const valueHtml = /^https?:\/\//.test(value)
            ? `<span class="agent-link">${escapeHtml(value)}</span>`
            : `<span class="agent-meta-value">${escapeHtml(value)}</span>`;

          return `
            <div class="agent-meta-line">
              <span class="agent-meta-label">${escapeHtml(label)}</span>
              <span class="agent-meta-sep">:</span>
              ${valueHtml}
            </div>
          `;
        }

        if (/^(Command|Preferred command|Fallback command|Alternate SkillsCat command):$/.test(trimmed)) {
          return `<div class="agent-section-label">${escapeHtml(trimmed)}</div>`;
        }

        if (/^https?:\/\//.test(trimmed)) {
          return `<div class="agent-endpoint-line"><span class="agent-endpoint-pill">${escapeHtml(trimmed)}</span></div>`;
        }

        if (trimmed.startsWith('npx ')) {
          return `<div class="agent-command-line"><code class="agent-command">${highlightCommand(trimmed)}</code></div>`;
        }

        if (
          trimmed.startsWith('This skill is ')
          || trimmed.startsWith('If CLI installation is not possible')
          || trimmed.startsWith('After installing')
        ) {
          return `<div class="agent-note-line">${highlightAgentPromptText(trimmed)}</div>`;
        }

        if (trimmed.startsWith('Install this SkillsCat skill')) {
          return `<div class="agent-intro-line">${escapeHtml(trimmed)}</div>`;
        }

        return `<div class="agent-body-line">${highlightAgentPromptText(trimmed)}</div>`;
      })
      .join('');
  }

  const highlightedAgentPrompt = $derived(highlightAgentPrompt(rawAgentPrompt));
  const canonicalSkillUrl = $derived(
    data.skill ? `${SITE_URL}/skills/${encodeSkillSlugForPath(data.skill.slug)}` : SITE_URL
  );
  const skillErrorKind = $derived(
    data.errorKind === 'temporary_failure' ? 'temporary_failure' : 'not_found'
  );
  const isTemporaryFailure = $derived(!data.skill && skillErrorKind === 'temporary_failure');
  const skillDescription = $derived(
    data.seo?.description
      || data.skill?.description
      || (
        data.skill
          ? i18n.t(copy.seoFallbackDescription, { name: data.skill.name })
          : (isTemporaryFailure ? copy.seoTemporaryUnavailableDescription : copy.seoNotFoundDescription)
      )
  );
  const skillSeoTitle = $derived(
    data.seo?.title
      || (
        data.skill
          ? `${data.skill.name} - SkillsCat`
          : (isTemporaryFailure ? copy.seoTemporaryUnavailableTitle : copy.seoNotFoundTitle)
      )
  );
  const ogImageUrl = $derived(
    data.skill
      ? buildOgImageUrl({
          type: 'skill',
          slug: data.skill.slug,
          version: data.skill.lastCommitAt ?? data.skill.updatedAt ?? data.skill.indexedAt,
        })
      : buildOgImageUrl({ type: 'page', slug: isTemporaryFailure ? '500' : '404' })
  );
  const errorTitle = $derived(
    isTemporaryFailure ? copy.temporarilyUnavailableTitle : copy.notFoundTitle
  );
  const errorMessage = $derived(
    isTemporaryFailure ? copy.temporarilyUnavailableMessage : (data.error || copy.notFoundMessage)
  );
  const errorCode = $derived(isTemporaryFailure ? 500 : 404);
  const seoImageAlt = $derived(
    data.skill
      ? i18n.t(copy.seoImageAlt, { name: data.skill.name })
      : (isTemporaryFailure ? copy.seoTemporaryUnavailableImageAlt : copy.seoNotFoundImageAlt)
  );
  const publishedTime = $derived(
    toIsoTimestamp(data.skill?.createdAt)
  );
  const modifiedTime = $derived(
    toIsoTimestamp(data.skill?.lastCommitAt ?? data.skill?.updatedAt)
  );
  const skillSeoKeywords = $derived(data.seo?.keywords ?? ['ai agent skill', 'skillscat']);
  const displayRecommendSkills = $derived(deferredRecommendSkills ?? data.recommendSkills ?? []);
  const showRecommendSkillsLoading = $derived(
    Boolean(data.deferRecommendSkills && data.skill && deferredRecommendSkills === null && !deferredRecommendSkillsError)
  );
  const showRecommendSkillsCard = $derived(
    displayRecommendSkills.length > 0 || showRecommendSkillsLoading || Boolean(deferredRecommendSkillsError)
  );
  const skillStructuredData = $derived(
    data.skill && data.skill.visibility === 'public'
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'SoftwareSourceCode',
            name: data.skill.name,
            description: skillDescription,
            url: canonicalSkillUrl,
            codeRepository: data.skill.githubUrl || undefined,
            datePublished: publishedTime || undefined,
            dateModified: modifiedTime || undefined,
            keywords: skillSeoKeywords.join(', '),
            about: (data.skill.categories || [])
              .map((slug) => getLocalizedCategoryBySlug(slug, i18n.locale())?.name)
              .filter(Boolean),
            author: {
              '@type': data.skill.orgName ? 'Organization' : 'Person',
              name: getAuthorDisplayName(),
            },
            publisher: {
              '@type': 'Organization',
              name: 'SkillsCat',
              url: SITE_URL,
            },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: copy.breadcrumbHome,
                item: SITE_URL,
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: copy.breadcrumbSkills,
                item: `${SITE_URL}/trending`,
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: data.skill.name,
                item: canonicalSkillUrl,
              }
            ],
          }
        ]
      : null
  );
</script>

{#if data.skill}
  <SEO
    title={skillSeoTitle}
    description={skillDescription}
    url={canonicalSkillUrl}
    image={ogImageUrl}
    imageAlt={seoImageAlt}
    type="article"
    author={getAuthorDisplayName()}
    publishedTime={publishedTime}
    modifiedTime={modifiedTime}
    noindex={data.skill.visibility !== 'public'}
    keywords={skillSeoKeywords}
    tags={data.seo?.articleTags}
    section={data.seo?.section}
    structuredData={skillStructuredData}
  />
{:else}
  <SEO
    title={skillSeoTitle}
    description={skillDescription}
    image={ogImageUrl}
    imageAlt={seoImageAlt}
    noindex
    structuredData={null}
  />
{/if}

{#if data.skill}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4 sm:pb-8 skill-detail-container">
    <!-- Breadcrumb -->
    <nav class="breadcrumb">
      <ol>
        <li class="breadcrumb-fixed hide-mobile"><a href="/">{copy.breadcrumbHome}</a></li>
        <li class="breadcrumb-sep hide-mobile">/</li>
        <li class="breadcrumb-fixed"><a href="/trending">{copy.breadcrumbSkills}</a></li>
        <li class="breadcrumb-sep">/</li>
        <li class="breadcrumb-truncate">
          <a
            href={getAuthorProfileUrl()}
          >
            {getAuthorDisplayName()}
          </a>
        </li>
        <li class="breadcrumb-sep">/</li>
        <li class="breadcrumb-truncate breadcrumb-current">{data.skill.name}</li>
      </ol>
    </nav>

    {#snippet renderActionButtons()}
      {@const githubUrl = data.skill?.githubUrl}
      <div class="action-buttons">
        <button onclick={handleDownload} class="download-btn action-btn" disabled={isDownloading}>
          {#if downloadSuccess}
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            {copy.installed}
          {:else if isDownloading}
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {copy.installing}
          {:else}
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {messages.common.download}
          {/if}
        </button>
        {#if githubUrl}
          <a href={githubUrl} target="_blank" rel="noopener noreferrer" class="github-btn action-btn">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
        {/if}
      </div>
    {/snippet}

    {#snippet renderInstallCard()}
      <h3 class="font-semibold text-fg mb-4">{messages.common.install}</h3>

      <div class="cli-switcher">
        {#each installOptions as option (option.id)}
          <button
            class="cli-switcher-btn"
            class:active={selectedInstallMethod === option.id}
            onclick={() => selectedInstallMethod = option.id}
          >
            {option.label}
          </button>
        {/each}
        <div
          class="cli-switcher-indicator"
          style:width={`calc((100% - (var(--switcher-padding) * 2)) / ${Math.max(installOptions.length, 1)})`}
          style:transform={`translateX(${selectedInstallOptionIndex * 100}%)`}
        ></div>
      </div>

      {#if currentInstallOption?.type === 'cli'}
        <div class="command-box">
          <code class="command-text">{@html highlightedCommand}</code>
          <CopyButton text={currentCommand} size="sm" />
        </div>

        <p class="command-description">
          {currentInstallOption.description}
        </p>
      {:else if currentInstallOption?.type === 'agent'}
        <div class="prompt-box">
          <div class="prompt-rich">
            {@html highlightedAgentPrompt}
          </div>
          <CopyButton text={rawAgentPrompt} size="sm" />
        </div>

        <p class="command-description">
          {currentInstallOption.description}
        </p>
      {/if}
    {/snippet}

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 skill-detail-layout">
      <!-- Main Content -->
      <div class="lg:col-span-2 space-y-8 main-content-column">
        <!-- Header -->
        <div class="card skill-header">
          <!-- Top row: Avatar + Title -->
          <div class="flex items-center mb-3 avatar-title-row">
            <!-- Avatar: clickable, links to author profile -->
            <a
              href={getAuthorProfileUrl()}
              class="avatar-link flex-shrink-0"
            >
              <Avatar
                src={getAuthorAvatarUrl()}
                alt={getAuthorDisplayName()}
                fallback={data.skill.repoOwner}
                size="md"
                useGithubFallback
              />
            </a>

            <!-- Title + Actions -->
            <div class="flex-1 min-w-0 flex items-center gap-3">
              <h1 class="skill-title-inline flex-1">{data.skill.name}</h1>
              <div class="skill-header-actions">
                {#if securitySummary}
                  <button
                    class="skill-action-btn security-btn"
                    data-risk={securityVisualRisk}
                    type="button"
                    aria-label={copy.securityScanLabel}
                  >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" />
                    </svg>
                    <div class="security-tooltip" role="tooltip">
                      <div class="security-tooltip-title">{copy.securityScanLabel}</div>
                      <div class="security-tooltip-row">
                        <span class="security-tooltip-label">{copy.securityAiScanLabel}</span>
                        <span class="security-risk-pill" data-risk={securitySummary.aiRiskLevel ?? 'unknown'}>
                          {securityAiLabel}
                        </span>
                      </div>
                      <div class="security-tooltip-row">
                        <span class="security-tooltip-label">{copy.securityVtScanLabel}</span>
                        <span class="security-risk-pill" data-risk={securitySummary.vtRiskLevel ?? 'unknown'}>
                          {securityVtLabel}
                        </span>
                      </div>

                      {#if shouldShowSecurityReasons}
                        {#if securityNarrative}
                          <div class="security-tooltip-section">
                            <div class="security-tooltip-section-label">{copy.securitySummaryLabel}</div>
                            <p class="security-tooltip-summary">{securityNarrative}</p>
                          </div>
                        {/if}

                        <div class="security-tooltip-section">
                          <div class="security-tooltip-section-label">{copy.securityFindingsLabel}</div>

                          {#if securityFindings.length > 0}
                            <div class="security-finding-list">
                              {#each securityFindings as finding}
                                <div class="security-finding-item">
                                  <div class="security-finding-head">
                                    <span class="security-finding-dimension">{formatSecurityDimensionLabel(finding.dimension)}</span>
                                    <span class="security-risk-pill security-score-pill" data-risk={getRiskLevelFromScore(finding.score)}>
                                      {finding.score.toFixed(1)}
                                    </span>
                                  </div>
                                  <div class="security-finding-path">{finding.filePath}</div>
                                  <p class="security-finding-reason">{finding.reason}</p>
                                </div>
                              {/each}
                            </div>
                          {:else if securityDimensions.length > 0}
                            <div class="security-dimension-list">
                              {#each securityDimensions as dimension}
                                <div class="security-dimension-item">
                                  <div class="security-finding-head">
                                    <span class="security-finding-dimension">{formatSecurityDimensionLabel(dimension.dimension)}</span>
                                    <span class="security-risk-pill security-score-pill" data-risk={getRiskLevelFromScore(dimension.score)}>
                                      {dimension.score.toFixed(1)}
                                    </span>
                                  </div>
                                  <p class="security-finding-reason">{dimension.reason}</p>
                                </div>
                              {/each}
                            </div>
                          {:else}
                            <p class="security-tooltip-empty">{copy.securityNoFindings}</p>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </button>
                {/if}

                <div
                  class="share-menu"
                  bind:this={shareMenuRoot}
                  role="group"
                  aria-label={copy.shareSkill}
                  onmouseenter={handleShareRootMouseEnter}
                  onmouseleave={handleShareRootMouseLeave}
                  onfocusin={handleShareRootFocusIn}
                  onfocusout={handleShareRootFocusOut}
                >
                  <button
                    bind:this={shareMenuTrigger}
                    type="button"
                    class="skill-action-btn share-btn"
                    aria-label={copy.shareSkill}
                    aria-haspopup="menu"
                    aria-expanded={shareMenuOpen}
                    aria-controls={shareMenuOpen ? 'skill-share-menu' : undefined}
                    data-state={shareMenuOpen ? 'open' : 'closed'}
                    onclick={() => {
                      if (shareMenuOpen) {
                        closeShareMenu();
                      } else {
                        void openShareMenu();
                      }
                    }}
                    onkeydown={handleShareTriggerKeydown}
                  >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </button>

                  {#if shareMenuOpen}
                    <div class="share-menu-panel">
                      <div
                        id="skill-share-menu"
                        class="share-dropdown-content"
                        role="menu"
                        tabindex="-1"
                        onkeydown={handleShareMenuKeydown}
                      >
                        {#if canUseNativeShare}
                          <button
                            type="button"
                            class="share-dropdown-item"
                            role="menuitem"
                            onclick={() => void runShareAction(handleNativeShare)}
                          >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                            </svg>
                            {copy.shareNative}
                          </button>
                        {/if}

                        <button
                          type="button"
                          class="share-dropdown-item"
                          role="menuitem"
                          onclick={() => void runShareAction(handleShareToX)}
                        >
                          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.901 1.154h3.681l-8.04 9.19 9.459 12.502h-7.406l-5.8-7.584-6.633 7.584H.48l8.6-9.826L0 1.154h7.594l5.243 6.932 6.064-6.932zm-1.291 19.49h2.04L6.486 3.24H4.297z" />
                          </svg>
                          {copy.shareToX}
                        </button>

                        <button
                          type="button"
                          class="share-dropdown-item"
                          role="menuitem"
                          onclick={() => void runShareAction(handleCopyUrl)}
                        >
                          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h6a2 2 0 002-2v-8a2 2 0 00-2-2h-6a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          {copy.copyUrl}
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>

                {#if bookmarkUiPending}
                  <div class="skill-action-btn bookmark-btn bookmark-btn-placeholder" aria-hidden="true">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </div>
                {:else if isAuthenticated}
                  <button
                    class="skill-action-btn bookmark-btn"
                    class:bookmarked={isBookmarked}
                    onclick={handleBookmark}
                    disabled={isBookmarking}
                    aria-label={isBookmarked ? copy.removeBookmark : copy.addBookmark}
                  >
                    <svg class="w-5 h-5" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
          </div>

          <!-- Description (full width) -->
          <p class="skill-description-full">{data.skill.description || copy.noDescription}</p>

          <!-- Meta row with badges -->
          <div class="skill-meta">
            <!-- Badges first -->
            {#if data.skill.visibility !== 'public'}
              <VisibilityBadge visibility={data.skill.visibility} size="md" />
            {/if}
            {#if data.skill.sourceType === 'upload'}
              <span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                {copy.uploaded}
              </span>
            {/if}

            <!-- Owner/Org link -->
            {#if data.skill.orgSlug}
              <a
                href="/org/{data.skill.orgSlug}"
                class="skill-meta-item"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                {data.skill.orgName}
              </a>
            {:else if data.skill.ownerName}
              <a
                href={data.skill.authorUsername
                  ? `/u/${encodeURIComponent(data.skill.authorUsername)}`
                  : `/u/${encodeURIComponent(data.skill.ownerName)}`}
                class="skill-meta-item"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {data.skill.ownerName}
              </a>
            {:else if data.skill.authorUsername}
              <a
                href={`/u/${encodeURIComponent(data.skill.authorUsername)}`}
                class="skill-meta-item"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {data.skill.authorDisplayName || data.skill.authorUsername}
              </a>
            {:else if data.skill.repoOwner}
              <a
                href={`/u/${encodeURIComponent(data.skill.repoOwner)}`}
                class="skill-meta-item"
              >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {data.skill.repoOwner}
              </a>
            {/if}

            <!-- Stars and Forks together -->
            {#if data.skill.sourceType === 'github'}
              <span class="skill-meta-item">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                </svg>
                {i18n.formatNumber(data.skill.stars)}
              </span>
              {#if data.skill.forks}
                <span class="skill-meta-item">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {i18n.formatNumber(data.skill.forks)}
                </span>
              {/if}
            {/if}

            <!-- License -->
            {#if data.skill.license}
              <span class="skill-meta-item">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {data.skill.license}
              </span>
            {/if}

            <span class="skill-meta-item">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {i18n.t(copy.updated, { time: formatRelativeTime(data.skill.updatedAt) })}
            </span>
          </div>
        </div>

        <!-- Resources (show above SKILL.md when non-readme files exist) -->
        {#if resourceFileStructure.length > 0}
          <DeferredSkillResourcesPanel
            skill={data.skill}
            files={resourceFileStructure}
            {copy}
            requestedFilePath={requestedResourceFilePath}
            requestedFilePathVersion={requestedResourceFilePathVersion}
          />
        {/if}

        <!-- Mobile: primary actions above SKILL.md -->
        <div class="mobile-primary-cards">
          <div class="card">
            {@render renderActionButtons()}
          </div>

          <div class="card">
            {@render renderInstallCard()}
          </div>
        </div>

        <!-- SKILL.md Content -->
        {#if data.hasReadme ?? Boolean(data.skill.readme)}
          <div class="card skill-content-card">
            <div class="skill-content-header">
              <svg class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span class="skill-content-title">SKILL.md</span>
            </div>
            <div class="skill-content-divider"></div>
            <div class="prose-readme">
              {@html renderedReadme}
            </div>
          </div>
        {/if}

        <!-- Categories -->
        {#if data.skill.categories?.length}
          <div class="card categories-card">
            <h2 class="text-lg font-semibold text-fg mb-4">{copy.categories}</h2>
            <div class="flex flex-wrap gap-2">
              {#each data.skill.categories as categorySlug}
                {@const category = getLocalizedCategoryBySlug(categorySlug, i18n.locale())}
                {#if category}
                  <a
                    href="/category/{categorySlug}"
                    class="category-tag"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    {category.name}
                  </a>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Sidebar -->
      <div class="space-y-6 sidebar-column">
        <!-- Actions -->
        <div class="card desktop-primary-card">
          {@render renderActionButtons()}
        </div>

        <!-- Install -->
        <div class="card desktop-primary-card">
          {@render renderInstallCard()}
        </div>

        <!-- Private Skill Notice -->
        {#if data.skill.visibility === 'private'}
          <div class="card bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div>
                <h4 class="font-medium text-yellow-800 dark:text-yellow-200">{copy.privateSkillTitle}</h4>
                <p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  {copy.privateSkillDescription}
                </p>
                <code class="block mt-2 text-xs bg-yellow-100 dark:bg-yellow-900/40 px-2 py-1 rounded">
                  skillscat login
                </code>
              </div>
            </div>
          </div>
        {/if}

        <!-- Dot-Folder Skill Notice -->
        {#if data.isDotFolderSkill}
          <div class="card bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 class="font-medium text-blue-800 dark:text-blue-200">{copy.repositoryStarsTitle}</h4>
                <p class="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  {i18n.t(copy.repositoryStarsDescription, { repo: `${data.skill.repoOwner}/${data.skill.repoName}` })}
                </p>
                {#if data.skill.skillPath}
                  <code class="block mt-2 text-xs bg-blue-100 dark:bg-blue-900/40 px-2 py-1 rounded">
                    {data.skill.skillPath}
                  </code>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        <!-- Recommend Skills -->
        {#if showRecommendSkillsCard}
          <div class="card recommend-skills-card">
            <h3 class="font-semibold text-fg mb-4">{copy.recommendSkills}</h3>
            {#if displayRecommendSkills.length > 0}
              <div class="space-y-3">
                {#each displayRecommendSkills as recommendSkill (recommendSkill.id)}
                  {@const recommendAuthor = formatRecommendAuthor(recommendSkill.repoOwner)}
                  <a
                    href={getRecommendSkillHref(recommendSkill.slug)}
                    class="recommend-skill-item"
                    title={`${recommendSkill.name}\n${recommendAuthor}`}
                  >
                    <div class="recommend-skill-avatar">
                      <Avatar
                        src={recommendSkill.authorAvatar}
                        fallback={recommendSkill.repoOwner}
                        alt={recommendSkill.repoOwner}
                        size="sm"
                        useGithubFallback
                      />
                    </div>

                    <div class="recommend-skill-copy">
                      <span class="recommend-skill-name">{recommendSkill.name}</span>
                      <span class="recommend-skill-author">{recommendAuthor}</span>
                    </div>

                    <div class="recommend-skill-meta">
                      <span class="recommend-skill-stars">
                        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                        </svg>
                        {formatRecommendStars(recommendSkill.stars)}
                      </span>
                      <span class="recommend-skill-updated">{formatRelativeTime(recommendSkill.updatedAt)}</span>
                    </div>
                  </a>
                {/each}
              </div>
            {:else if showRecommendSkillsLoading}
              <div class="space-y-3" aria-busy="true" aria-live="polite">
                <div class="h-20 rounded-lg border border-border bg-bg-muted/40 animate-pulse"></div>
                <div class="h-20 rounded-lg border border-border bg-bg-muted/40 animate-pulse"></div>
                <div class="h-20 rounded-lg border border-border bg-bg-muted/40 animate-pulse"></div>
              </div>
            {:else}
              <p class="text-sm text-fg-muted">{copy.recommendUnavailable}</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <ErrorState
    code={errorCode}
    title={errorTitle}
    message={errorMessage}
    fullPage
    primaryActionText={isTemporaryFailure ? messages.common.tryAgain : messages.common.browseSkills}
    primaryActionClick={isTemporaryFailure ? retryCurrentPage : undefined}
    primaryActionHref={isTemporaryFailure ? undefined : '/trending'}
    secondaryActionText={isTemporaryFailure ? messages.common.browseSkills : undefined}
    secondaryActionHref={isTemporaryFailure ? '/trending' : undefined}
  />
{/if}

<style>
  /* Breadcrumb */
  .breadcrumb {
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
    overflow: hidden;
  }

  .breadcrumb ol {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--fg-muted);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .breadcrumb a {
    color: inherit;
    text-decoration: none;
    transition: color 0.15s ease;
  }

  .breadcrumb a:hover {
    color: var(--primary);
  }

  .breadcrumb-fixed {
    flex-shrink: 0;
  }

  .breadcrumb-sep {
    flex-shrink: 0;
    opacity: 0.5;
  }

  .breadcrumb-truncate {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .breadcrumb-truncate a {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .breadcrumb-current {
    color: var(--fg);
    font-weight: 500;
  }

  @media (max-width: 640px) {
    .breadcrumb .hide-mobile {
      display: none;
    }
  }

  /* Skill Header Styles */
  .skill-header {
    padding: 1.5rem;
  }

  .avatar-link {
    display: block;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }

  .avatar-link:hover {
    transform: scale(1.05);
    opacity: 0.9;
  }

  .skill-title-inline {
    font-size: clamp(1.5rem, 3.5vw, 1.875rem);
    font-weight: 800;
    color: var(--fg);
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .avatar-title-row {
    gap: 0.75rem;
  }

  .skill-header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .share-menu {
    position: relative;
  }

  .share-menu-panel {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 60;
  }

  /* Header Action Buttons */
  :global(.skill-action-btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    color: var(--fg-muted);
    background: var(--bg-subtle);
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  :global(.skill-action-btn:hover) {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-subtle);
  }

  :global(.skill-action-btn:active) {
    transform: translateY(1px) scale(0.97);
  }

  :global(.skill-action-btn[data-state='open']) {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-subtle);
  }

  .bookmark-btn.bookmarked {
    color: var(--primary);
    background: var(--primary-subtle);
    border-color: var(--primary);
  }

  .security-btn {
    position: relative;
    color: var(--security-accent, var(--fg-muted));
    border-color: var(--security-accent, var(--border));
  }

  .security-btn[data-risk='mid'] {
    --security-accent: var(--warning);
  }

  .security-btn[data-risk='high'],
  .security-btn[data-risk='fatal'] {
    --security-accent: var(--destructive);
  }

  .security-btn:hover {
    color: var(--security-accent, var(--primary));
    border-color: var(--security-accent, var(--primary));
    background: var(--primary-subtle);
  }

  .security-tooltip {
    position: absolute;
    right: 0;
    top: calc(100% + 0.65rem);
    width: min(22rem, calc(100vw - 1.5rem));
    min-width: min(19rem, calc(100vw - 1.5rem));
    padding: 0.75rem 0.875rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    color: var(--fg);
    opacity: 0;
    pointer-events: none;
    transform: translateY(-6px);
    transition: opacity 0.18s ease, transform 0.18s ease;
    z-index: 70;
  }

  .security-btn:hover .security-tooltip,
  .security-btn:focus-visible .security-tooltip {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .security-tooltip-title {
    font-size: 0.75rem;
    font-weight: 700;
    margin-bottom: 0.375rem;
    color: var(--fg);
    text-align: left;
  }

  .security-tooltip-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--fg-muted);
  }

  .security-tooltip-row + .security-tooltip-row {
    margin-top: 0.375rem;
  }

  .security-tooltip-label {
    font-weight: 600;
    color: var(--fg-muted);
  }

  .security-tooltip-section {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    text-align: left;
  }

  .security-tooltip-section-label {
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-subtle);
  }

  .security-tooltip-summary,
  .security-tooltip-empty {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.55;
    color: var(--fg-muted);
  }

  .security-risk-pill {
    padding: 0.1rem 0.5rem;
    border-radius: 9999px;
    font-weight: 700;
    font-size: 0.7rem;
    letter-spacing: 0.02em;
    color: var(--fg-muted);
    background: var(--bg-muted);
  }

  .security-risk-pill[data-risk='mid'] {
    color: var(--warning);
  }

  .security-risk-pill[data-risk='high'],
  .security-risk-pill[data-risk='fatal'] {
    color: var(--destructive);
  }

  .security-risk-pill[data-risk='low'] {
    color: var(--success);
  }

  .security-risk-pill[data-risk='unknown'] {
    color: var(--fg-subtle);
  }

  .security-finding-list,
  .security-dimension-list {
    display: grid;
    gap: 0.5rem;
  }

  .security-finding-item,
  .security-dimension-item {
    padding: 0.55rem 0.625rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-subtle);
  }

  .security-finding-head {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
    text-align: left;
  }

  .security-finding-dimension {
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--fg);
    line-height: 1.35;
  }

  .security-score-pill {
    display: inline-flex;
    align-items: center;
    min-width: 2.7rem;
    justify-content: center;
    margin-left: auto;
  }

  .security-finding-path {
    margin-bottom: 0.3rem;
    font-size: 0.67rem;
    line-height: 1.4;
    color: var(--fg-subtle);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    word-break: break-all;
  }

  .security-finding-reason {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.5;
    color: var(--fg-muted);
  }

  .bookmark-btn-placeholder {
    color: var(--fg-subtle);
    cursor: default;
    pointer-events: none;
    opacity: 0.72;
    animation: bookmark-placeholder-pulse 1.4s ease-in-out infinite;
  }

  @keyframes bookmark-placeholder-pulse {
    0%, 100% {
      opacity: 0.52;
    }
    50% {
      opacity: 0.9;
    }
  }

  :global(.skill-action-btn:focus-visible) {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  :global(.skill-action-btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .share-dropdown-content {
    min-width: 11.5rem;
    background-color: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow:
      0 10px 25px -5px rgb(0 0 0 / 0.1),
      0 10px 10px -5px rgb(0 0 0 / 0.04);
    padding: 0.375rem;
    z-index: 60;
  }

  .share-dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.625rem;
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--fg);
    font-size: 0.875rem;
    line-height: 1.35;
    text-align: left;
    cursor: pointer;
    user-select: none;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .share-dropdown-item:hover,
  .share-dropdown-item:focus-visible {
    background: var(--bg-muted);
    color: var(--primary);
  }

  .share-dropdown-item:focus-visible {
    outline: none;
  }

  .skill-description-full {
    font-size: 0.9375rem;
    color: var(--fg-muted);
    line-height: 1.6;
    margin-bottom: 1rem;
  }

  .skill-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .recommend-skill-item {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 0.875rem 1rem;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: 0.875rem;
    text-decoration: none;
    transition:
      border-color 0.2s ease,
      transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275),
      box-shadow 0.2s ease;
  }

  .recommend-skill-item:hover {
    border-color: var(--border-sketch);
    transform: translateY(-2px) translateX(-2px);
    box-shadow: 4px 4px 0 0 var(--border-sketch);
  }

  .recommend-skill-avatar {
    flex-shrink: 0;
  }

  .recommend-skill-copy {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
  }

  .recommend-skill-name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s ease;
  }

  .recommend-skill-item:hover .recommend-skill-name {
    color: var(--primary);
  }

  .recommend-skill-author {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: 0.75rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recommend-skill-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
    color: var(--fg-muted);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .recommend-skill-stars {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: var(--bg-muted);
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .recommend-skill-item:hover .recommend-skill-stars {
    background: var(--primary-subtle);
    color: var(--primary);
  }

  .recommend-skill-updated {
    color: var(--fg-subtle);
  }

  .skill-meta-item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    color: var(--fg-muted);
    text-decoration: none;
    transition: color 0.15s ease;
  }

  a.skill-meta-item:hover {
    color: var(--primary);
  }

  /* Download Button */
  .download-btn {
    --btn-shadow-offset: 4px;
    --btn-shadow-color: oklch(50% 0.22 55);

    display: flex;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: #ffffff;
    background-color: var(--primary);
    border: none;
    border-radius: var(--radius-full);
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
    cursor: pointer;
    text-decoration: none;
    transform: translateY(0);
    transition:
      transform 0.1s ease,
      box-shadow 0.1s ease,
      background-color 0.15s ease;
  }

  .download-btn:hover {
    --btn-shadow-offset: 6px;
    background-color: var(--primary-hover);
    transform: translateY(-2px);
  }

  .download-btn:active {
    --btn-shadow-offset: 1px;
    transform: translateY(3px);
  }

  :root.dark .download-btn {
    --btn-shadow-color: oklch(40% 0.20 55);
  }

  .download-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .download-btn:disabled:hover {
    transform: translateY(0);
    --btn-shadow-offset: 4px;
  }

  .mobile-primary-cards {
    display: none;
    gap: 1rem;
  }

  .desktop-primary-card {
    display: block;
  }

  .action-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .action-buttons > * {
    min-width: 0;
  }

  .action-btn {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
  }

  /* Category Tags */
  .category-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--fg);
    background: var(--bg-subtle);
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .category-tag:hover {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-subtle);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px -4px rgba(0, 0, 0, 0.1);
  }

  .github-btn {
    --gh-shadow-offset: 3px;
    --gh-bg: #24292e;
    --gh-bg-hover: #2f363d;
    --gh-shadow: #1b1f23;

    display: flex;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: #ffffff;
    background-color: var(--gh-bg);
    border: none;
    border-radius: var(--radius-full);
    box-shadow: 0 var(--gh-shadow-offset) 0 0 var(--gh-shadow);
    cursor: pointer;
    text-decoration: none;
    transform: translateY(0);
    transition:
      transform 0.1s ease,
      box-shadow 0.1s ease,
      background-color 0.15s ease;
  }

  .github-btn:hover {
    --gh-shadow-offset: 4px;
    background-color: var(--gh-bg-hover);
    transform: translateY(-1px);
  }

  .github-btn:active {
    --gh-shadow-offset: 1px;
    transform: translateY(2px);
  }

  /* CLI Switcher */
  .cli-switcher {
    --switcher-padding: 2px;
    --switcher-shadow: 2px;
    position: relative;
    display: flex;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: var(--switcher-padding);
    background: var(--bg-subtle);
    border: 2px solid var(--border);
    border-radius: 9999px;
    margin-bottom: 1rem;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .cli-switcher-btn {
    position: relative;
    z-index: 1;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.3125rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--fg-muted);
    background: transparent;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    transition: color 0.2s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cli-switcher-btn:hover {
    color: var(--fg);
  }

  .cli-switcher-btn.active {
    color: white;
  }

  .cli-switcher-indicator {
    position: absolute;
    top: var(--switcher-padding);
    bottom: var(--switcher-padding);
    left: var(--switcher-padding);
    width: calc(100% - (var(--switcher-padding) * 2));
    background: var(--primary);
    border-radius: 9999px;
    box-shadow: 0 var(--switcher-shadow) 0 0 oklch(50% 0.22 55);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  :root.dark .cli-switcher-indicator {
    box-shadow: 0 var(--switcher-shadow) 0 0 oklch(40% 0.20 55);
  }

  /* Command Box Styles */
  .command-box {
    display: flex;
    box-sizing: border-box;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg);
    border-radius: var(--radius-lg);
    border: 2px solid var(--border);
    font-family: var(--font-mono);
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
  }

  :root:not(.dark) .command-box {
    background: #fafafa;
    border-color: #e5e5e5;
  }

  .command-text {
    display: block;
    flex: 1;
    min-width: 0;
    max-width: 100%;
    color: var(--fg);
    font-size: 0.8125rem;
    overflow-x: auto;
    white-space: nowrap;
    line-height: 1.5;
    /* Hide scrollbar */
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .command-text::-webkit-scrollbar {
    display: none;
  }

  /* Command syntax highlighting */
  .command-text :global(.cmd-npx) {
    color: var(--accent);
    font-weight: 600;
  }

  .command-text :global(.cmd-tool) {
    color: var(--fg);
    font-weight: 500;
  }

  .command-text :global(.cmd-action) {
    color: var(--primary);
    font-weight: 600;
  }

  .command-text :global(.cmd-repo) {
    color: var(--fg-muted);
  }

  .command-text :global(.cmd-default) {
    color: var(--fg);
  }

  .prompt-box {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    overflow: hidden;
    background:
      radial-gradient(circle at top right, color-mix(in oklch, var(--primary) 14%, transparent), transparent 35%),
      linear-gradient(135deg, color-mix(in oklch, var(--bg) 88%, var(--primary) 12%), var(--bg));
    border-radius: var(--radius-lg);
    border: 2px solid color-mix(in oklch, var(--border) 82%, var(--primary) 18%);
    box-shadow: 0 12px 28px -18px color-mix(in oklch, var(--primary) 30%, transparent);
  }

  .prompt-box::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: linear-gradient(180deg, var(--primary), var(--accent));
  }

  :root:not(.dark) .prompt-box {
    background:
      radial-gradient(circle at top right, rgba(242, 107, 41, 0.12), transparent 35%),
      linear-gradient(135deg, #fffaf7, #fafafa);
    border-color: rgba(242, 107, 41, 0.22);
    box-shadow: 0 12px 24px -18px rgba(242, 107, 41, 0.45);
  }

  .prompt-rich {
    position: relative;
    z-index: 1;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.55;
  }

  .prompt-box :global(.copy-button) {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
  }

  .prompt-rich :global(.agent-intro-line) {
    font-family: var(--font-sans);
    font-size: 0.88rem;
    font-weight: 700;
    line-height: 1.45;
    color: var(--fg);
  }

  .prompt-rich :global(.agent-body-line) {
    color: var(--fg-muted);
  }

  .prompt-rich :global(.agent-section-label) {
    margin-top: 0.15rem;
    font-family: var(--font-sans);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--primary);
  }

  .prompt-rich :global(.agent-meta-line) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: baseline;
  }

  .prompt-rich :global(.agent-meta-label) {
    font-family: var(--font-sans);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .prompt-rich :global(.agent-meta-sep) {
    color: var(--fg-subtle);
  }

  .prompt-rich :global(.agent-meta-value) {
    color: var(--fg);
    font-weight: 600;
  }

  .prompt-rich :global(.agent-link) {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 0.125rem 0.5rem;
    color: var(--primary);
    background: color-mix(in oklch, var(--primary) 10%, transparent);
    border: 1px solid color-mix(in oklch, var(--primary) 18%, transparent);
    border-radius: 9999px;
    word-break: break-all;
  }

  .prompt-rich :global(.agent-command-line) {
    padding: 0.7rem 0.85rem;
    background: color-mix(in oklch, var(--bg) 72%, var(--primary) 10%);
    border: 1px solid color-mix(in oklch, var(--border) 70%, var(--primary) 18%);
    border-radius: calc(var(--radius-lg) - 2px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .prompt-rich :global(.agent-command-line::-webkit-scrollbar) {
    display: none;
  }

  .prompt-rich :global(.agent-command) {
    display: block;
    white-space: nowrap;
    color: var(--fg);
  }

  .prompt-rich :global(.agent-command .cmd-npx) {
    color: var(--accent);
    font-weight: 600;
  }

  .prompt-rich :global(.agent-command .cmd-tool) {
    color: var(--fg);
    font-weight: 600;
  }

  .prompt-rich :global(.agent-command .cmd-action) {
    color: var(--primary);
    font-weight: 700;
  }

  .prompt-rich :global(.agent-command .cmd-repo) {
    color: var(--fg-muted);
  }

  .prompt-rich :global(.agent-command .cmd-default) {
    color: var(--fg);
  }

  .prompt-rich :global(.agent-note-line) {
    padding: 0.65rem 0.75rem;
    color: var(--fg);
    background: color-mix(in oklch, var(--accent) 11%, transparent);
    border: 1px solid color-mix(in oklch, var(--accent) 20%, transparent);
    border-radius: calc(var(--radius-lg) - 4px);
  }

  .prompt-rich :global(.agent-inline-code) {
    display: inline-flex;
    align-items: center;
    padding: 0.05rem 0.35rem;
    margin: 0 0.1rem;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--primary);
    background: color-mix(in oklch, var(--primary) 12%, transparent);
    border-radius: 0.4rem;
  }

  .prompt-rich :global(.agent-endpoint-line) {
    display: flex;
  }

  .prompt-rich :global(.agent-endpoint-pill) {
    display: inline-flex;
    max-width: 100%;
    padding: 0.45rem 0.65rem;
    color: var(--fg);
    background: color-mix(in oklch, var(--bg) 74%, var(--accent) 9%);
    border: 1px dashed color-mix(in oklch, var(--border) 72%, var(--primary) 16%);
    border-radius: calc(var(--radius-lg) - 6px);
    word-break: break-all;
  }

  .prompt-rich :global(.agent-spacer) {
    height: 0.2rem;
  }

  /* Command Description */
  .command-description {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--fg-muted);
    line-height: 1.5;
  }

  /* README Markdown Styles */
  .prose-readme {
    color: var(--fg);
    font-size: 0.9375rem;
    line-height: 1.7;
    padding: 0.5rem;
  }

  .prose-readme :global(> *:first-child) {
    margin-top: 0;
  }

  .prose-readme :global(> *:last-child) {
    margin-bottom: 0;
  }

  .prose-readme :global(h1),
  .prose-readme :global(h2),
  .prose-readme :global(h3),
  .prose-readme :global(h4),
  .prose-readme :global(h5),
  .prose-readme :global(h6) {
    color: var(--fg);
    font-weight: 600;
    margin-top: 1.75em;
    margin-bottom: 0.75em;
    line-height: 1.3;
  }

  .prose-readme :global(h1) { font-size: 1.5rem; }
  .prose-readme :global(h2) { font-size: 1.25rem; }
  .prose-readme :global(h3) { font-size: 1.125rem; }

  .prose-readme :global(p) {
    margin-bottom: 1.25em;
  }

  .prose-readme :global(a) {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .prose-readme :global(a:hover) {
    color: var(--primary-hover);
  }

  /* Relative file links in markdown */
  .prose-readme :global(.file-link) {
    color: var(--primary);
    text-decoration: underline;
    text-decoration-style: dashed;
    text-underline-offset: 2px;
    cursor: pointer;
    transition: color 0.15s ease, text-decoration-color 0.15s ease;
  }

  .prose-readme :global(.file-link:hover) {
    color: var(--primary-hover);
    text-decoration-style: solid;
  }

  .prose-readme :global(code) {
    background: var(--bg-emphasis);
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85em;
    border: 1px solid var(--border);
  }

  .prose-readme :global(pre) {
    background: var(--bg-emphasis);
    padding: 1rem 1.25rem;
    border-radius: var(--radius-md);
    overflow-x: auto;
    margin: 1.5em 0;
    border: 1px solid var(--border);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .prose-readme :global(pre::-webkit-scrollbar) {
    height: 6px;
  }

  .prose-readme :global(pre::-webkit-scrollbar-track) {
    background: transparent;
  }

  .prose-readme :global(pre::-webkit-scrollbar-thumb) {
    background: var(--border);
    border-radius: 3px;
  }

  .prose-readme :global(pre::-webkit-scrollbar-thumb:hover) {
    background: var(--fg-muted);
  }

  .prose-readme :global(pre code) {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
    line-height: 1.7;
    border: none;
  }

  /* Shiki code block styles */
  .prose-readme :global(.shiki) {
    padding: 1rem 1.25rem;
    border-radius: var(--radius-md);
    overflow-x: auto;
    margin: 1.5em 0;
    border: 1px solid var(--border);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar) {
    height: 6px;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar-track) {
    background: transparent;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar-thumb) {
    background: var(--border);
    border-radius: 3px;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar-thumb:hover) {
    background: var(--fg-muted);
  }

  .prose-readme :global(.shiki code) {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
    line-height: 1.7;
    border: none;
  }

  /* Code block with filename header */
  .prose-readme :global(.code-block-wrapper) {
    margin: 1.5em 0;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .prose-readme :global(.code-block-header) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: var(--bg-muted);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-muted);
    font-weight: 500;
  }

  .prose-readme :global(.code-block-wrapper .shiki),
  .prose-readme :global(.code-block-wrapper pre) {
    margin: 0;
    border: none;
    border-radius: 0;
  }

  /* Light/dark mode for shiki */
  :root:not(.dark) .prose-readme :global(.shiki),
  :root:not(.dark) .prose-readme :global(.shiki span) {
    color: var(--shiki-light) !important;
    background-color: var(--shiki-light-bg) !important;
  }

  :root.dark .prose-readme :global(.shiki) {
    background-color: #0d1117 !important;
  }

  :root.dark .prose-readme :global(.shiki span) {
    color: var(--shiki-dark) !important;
  }

  .prose-readme :global(ul) {
    margin: 1em 0;
    padding-left: 1.5em;
    list-style-type: disc;
  }

  .prose-readme :global(ol) {
    margin: 1em 0;
    padding-left: 1.5em;
    list-style-type: decimal;
  }

  .prose-readme :global(li) {
    margin-bottom: 0.5em;
  }

  .prose-readme :global(blockquote) {
    border-left: 4px solid var(--primary);
    padding-left: 1rem;
    margin: 1em 0;
    color: var(--fg-muted);
    font-style: italic;
  }

  .prose-readme :global(hr) {
    border: none;
    border-top: 2px solid var(--border);
    margin: 2em 0;
  }

  .prose-readme :global(table) {
    display: block;
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .prose-readme :global(th),
  .prose-readme :global(td) {
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    text-align: left;
    vertical-align: top;
  }

  .prose-readme :global(th) {
    background: var(--bg-subtle);
    font-weight: 600;
  }

  .prose-readme :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
    margin: 1em 0;
  }

  /* SKILL.md Content Card Styles */
  .skill-content-card {
    padding: 2rem;
  }

  .skill-content-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .skill-content-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--fg);
    font-family: var(--font-mono);
  }

  .skill-content-divider {
    height: 2px;
    background: linear-gradient(90deg, var(--primary) 0%, transparent 100%);
    margin-bottom: 1.5rem;
    border-radius: 1px;
  }

  .skill-detail-container {
    padding-top: 0.25rem;
  }

  /* Single-column spacing for tablet/mobile (iPad portrait included) */
  @media (max-width: 1023px) {
    .mobile-primary-cards {
      display: flex;
      flex-direction: column;
    }

    .desktop-primary-card {
      display: none;
    }

    .main-content-column,
    .sidebar-column,
    .mobile-primary-cards {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .main-content-column > *,
    .sidebar-column > * {
      margin-top: 0 !important;
    }

    .skill-detail-layout {
      row-gap: 1rem;
    }
  }

  @media (min-width: 640px) and (max-width: 1023px) {
    .skill-detail-container {
      padding-top: 0.5rem;
    }
  }

  @media (min-width: 1024px) {
    .skill-detail-container {
      padding-top: 1.25rem;
    }

    .avatar-title-row {
      gap: 0.9375rem;
    }

    .mobile-primary-cards {
      display: none;
    }

    .desktop-primary-card {
      display: block;
    }
  }

  /* Mobile Responsive Styles */
  @media (max-width: 640px) {
    .skill-header {
      padding: 1.25rem;
    }

    .skill-title-inline {
      font-size: 1.25rem;
    }

    .skill-description-full {
      font-size: 0.875rem;
    }

    .skill-meta {
      gap: 0.75rem;
    }

    .skill-meta-item {
      font-size: 0.8125rem;
    }

    .command-box {
      gap: 0.5rem;
    }

    .command-text {
      font-size: 0.75rem;
    }

    .main-content-column,
    .sidebar-column {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .main-content-column > *,
    .sidebar-column > * {
      margin-top: 0 !important;
    }

    .skill-detail-layout {
      row-gap: 0.75rem;
    }

    .main-content-column > .categories-card > h2,
    .sidebar-column > .recommend-skills-card > h3 {
      font-size: 1rem;
      line-height: 1.4;
    }

    .skill-content-title {
      font-size: 0.9375rem;
      line-height: 1.4;
    }

    .action-buttons {
      flex-direction: row;
      flex-wrap: nowrap;
      gap: 0.625rem;
    }

    .download-btn,
    .github-btn {
      padding: 0.6875rem 0.5rem;
      font-size: 0.75rem;
      gap: 0.375rem;
    }

    .action-btn svg {
      width: 1rem;
      height: 1rem;
      flex-shrink: 0;
    }

    .cli-switcher-btn {
      padding: 0.25rem 0.375rem;
      font-size: 0.6875rem;
    }

    .command-box {
      padding: 0.625rem 0.75rem;
    }

    .prose-readme :global(th),
    .prose-readme :global(td) {
      padding: 0.375rem 0.5rem;
      font-size: 0.8125rem;
    }

    .category-tag {
      padding: 0.3125rem 0.625rem;
      font-size: 0.75rem;
      gap: 0.25rem;
      border-width: 1px;
    }

    .category-tag svg {
      display: none;
    }

    .skill-content-card {
      padding: 1.25rem;
    }

    .skill-content-divider {
      margin-bottom: 1rem;
    }
  }
</style>
