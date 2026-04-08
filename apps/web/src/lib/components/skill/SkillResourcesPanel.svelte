  <script lang="ts">
  import { untrack } from 'svelte';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { ensureClientShikiLanguage, getClientShikiHighlighter } from '$lib/shiki-client';
  import type { FileNode, SkillDetail } from '$lib/types';

  interface SkillResourcesCopy {
    resources: string;
    loadingFile: string;
    binaryFile: string;
    binaryFileHint: string;
  }

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

  let expandedFolders = $state<Set<string>>(new Set());
  let selectedFile = $state<string | null>(null);
  let fileContent = $state<string | null>(null);
  let fileLoading = $state(false);
  let fileError = $state<string | null>(null);
  let highlightedFileContent = $state('');
  let highlighter = $state<Awaited<ReturnType<typeof getClientShikiHighlighter>> | null>(null);
  let isLoadingShiki = $state(false);
  let activeFileSelectionId = $state(0);
  let allowDirectGitHubRead = $state(true);
  let pendingClientRateLimitSignal = $state(false);

  const encodedApiSkillSlug = $derived(encodeURIComponent(skill.slug));
  const canUseDirectGitHubRead = $derived(Boolean(
    skill.visibility === 'public'
    && skill.sourceType === 'github'
    && skill.repoOwner
    && skill.repoName
  ));

  const MAX_DIRECT_DOWNLOAD_FILES = 12;
  const MAX_DIRECT_FILE_SIZE = 512 * 1024;
  const MIN_DIRECT_RATE_LIMIT_REMAINING = 15;
  const CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY = 'skillscat:github-client-rate-limit-until';
  const CLIENT_GITHUB_RATE_LIMIT_FALLBACK_HEADER = 'x-skillscat-client-github-rate-limited';
  const DEFAULT_CLIENT_GITHUB_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

  const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'tar', 'gz', 'rar', '7z',
    'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'webm',
    'exe', 'dll', 'so', 'dylib',
    'woff', 'woff2', 'ttf', 'otf', 'eot'
  ]);

  $effect(() => {
    skill.id;
    expandedFolders = new Set();
    selectedFile = null;
    fileContent = null;
    fileLoading = false;
    fileError = null;
    highlightedFileContent = '';
    highlighter = null;
    isLoadingShiki = false;
    activeFileSelectionId = 0;
    allowDirectGitHubRead = true;
    pendingClientRateLimitSignal = false;
  });

  function isBinaryFile(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return BINARY_EXTENSIONS.has(ext);
  }

  function isSkillReadmeFile(path: string): boolean {
    return path.replace(/^\.\//, '').toLowerCase() === 'skill.md';
  }

  function escapeCssSelectorValue(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/["\\\]]/g, '\\$&');
  }

  function getStoredClientRateLimitUntil(): number | null {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY);
    if (!raw) return null;

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function setStoredClientRateLimitUntil(untilMs: number): void {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY, String(untilMs));
  }

  function parseRateLimitRemaining(headers: Headers): number | null {
    const value = headers.get('x-ratelimit-remaining');
    if (!value) return null;

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseRateLimitResetMs(headers: Headers): number | null {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Date.now() + (seconds * 1000);
      }

      const asDate = Date.parse(retryAfter);
      if (Number.isFinite(asDate)) {
        return asDate;
      }
    }

    const resetEpoch = headers.get('x-ratelimit-reset');
    if (!resetEpoch) return null;

    const parsed = Number.parseInt(resetEpoch, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return parsed * 1000;
  }

  function markClientGithubRateLimited(headers: Headers): void {
    allowDirectGitHubRead = false;
    pendingClientRateLimitSignal = true;

    const resetAt = parseRateLimitResetMs(headers) ?? (Date.now() + DEFAULT_CLIENT_GITHUB_RATE_LIMIT_WINDOW_MS);
    setStoredClientRateLimitUntil(resetAt);
  }

  function consumeClientRateLimitSignalHeaders(): HeadersInit | undefined {
    if (!pendingClientRateLimitSignal) return undefined;

    pendingClientRateLimitSignal = false;
    return { [CLIENT_GITHUB_RATE_LIMIT_FALLBACK_HEADER]: '1' };
  }

  $effect(() => {
    const storedUntil = getStoredClientRateLimitUntil();
    if (!storedUntil) return;

    if (storedUntil > Date.now()) {
      allowDirectGitHubRead = false;
      return;
    }

    window.sessionStorage.removeItem(CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY);
  });

  function decodeGitHubBase64ToUtf8(base64: string): string {
    const cleanBase64 = base64.replace(/\n/g, '');
    const binaryString = atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new TextDecoder('utf-8').decode(bytes);
  }

  function buildGitHubContentApiUrl(relativePath: string): string | null {
    if (!canUseDirectGitHubRead || !allowDirectGitHubRead) return null;

    const normalizedRelativePath = relativePath.replace(/^\/+/, '').replace(/^\.\//, '');
    if (!normalizedRelativePath || normalizedRelativePath.includes('..')) return null;

    const fullPath = skill.skillPath
      ? `${skill.skillPath}/${normalizedRelativePath}`.replace(/^\/+/, '')
      : normalizedRelativePath;

    const encodedPath = fullPath
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    if (!encodedPath) return null;

    return `https://api.github.com/repos/${encodeURIComponent(skill.repoOwner)}/${encodeURIComponent(skill.repoName)}/contents/${encodedPath}`;
  }

  interface GitHubContentResponse {
    content?: string;
    encoding?: string;
    size?: number;
    type?: string;
  }

  interface DirectGitHubFileResult {
    content: string | null;
    remaining: number | null;
  }

  async function fetchGitHubFileDirect(relativePath: string): Promise<DirectGitHubFileResult> {
    const contentUrl = buildGitHubContentApiUrl(relativePath);
    if (!contentUrl) return { content: null, remaining: null };

    const response = await fetch(contentUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });

    const remaining = parseRateLimitRemaining(response.headers);
    if (remaining !== null && remaining <= MIN_DIRECT_RATE_LIMIT_REMAINING) {
      allowDirectGitHubRead = false;
    }

    if (response.status === 404) {
      allowDirectGitHubRead = false;
      return { content: null, remaining };
    }

    if (response.status === 429 || (response.status === 403 && remaining === 0)) {
      markClientGithubRateLimited(response.headers);
      return { content: null, remaining };
    }

    if (!response.ok) {
      throw new Error(`GitHub fetch failed (${response.status})`);
    }

    const payload = await response.json() as GitHubContentResponse;
    if (payload.type !== 'file' || payload.encoding !== 'base64' || !payload.content) {
      throw new Error('Unexpected GitHub content response');
    }

    if (payload.size && payload.size > MAX_DIRECT_FILE_SIZE) {
      throw new Error('File too large');
    }

    return {
      content: decodeGitHubBase64ToUtf8(payload.content),
      remaining,
    };
  }

  function toggleFolder(path: string) {
    const nextSet = new Set(expandedFolders);
    if (nextSet.has(path)) {
      nextSet.delete(path);
    } else {
      nextSet.add(path);
    }
    expandedFolders = nextSet;
  }

  function expandParentFolders(filePath: string) {
    const parts = filePath.split('/');
    const nextSet = new Set(expandedFolders);
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      nextSet.add(currentPath);
    }

    expandedFolders = nextSet;
  }

  function findFile(nodes: FileNode[], targetPath: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === targetPath || node.path.endsWith(`/${targetPath}`) || node.path === targetPath.replace(/^\//, '')) {
        return node;
      }
      if (node.children) {
        const found = findFile(node.children, targetPath);
        if (found) return found;
      }
    }

    return null;
  }

  async function loadShikiHighlighter(): Promise<void> {
    if (highlighter || isLoadingShiki) return;

    isLoadingShiki = true;
    try {
      highlighter = await getClientShikiHighlighter();
    } catch (error) {
      console.error('Failed to load file highlighter:', error);
    } finally {
      isLoadingShiki = false;
    }
  }

  async function updateHighlightedFileContent(
    path: string,
    content: string,
    selectionId: number
  ): Promise<void> {
    if (!content) {
      highlightedFileContent = '';
      return;
    }

    if (!highlighter) {
      await loadShikiHighlighter();
    }

    if (!highlighter) {
      highlightedFileContent = '';
      return;
    }

    if (selectionId !== activeFileSelectionId || selectedFile !== path) {
      return;
    }

    const ext = path.split('.').pop()?.toLowerCase() || 'plaintext';
    const langMap: Record<string, string> = {
      'js': 'javascript', 'ts': 'typescript', 'py': 'python',
      'sh': 'bash', 'yml': 'yaml', 'md': 'markdown'
    };
    const lang = await ensureClientShikiLanguage(highlighter, langMap[ext] || ext);
    if (selectionId !== activeFileSelectionId || selectedFile !== path) {
      return;
    }

    try {
      const nextHighlightedContent = highlighter.codeToHtml(content, {
        lang,
        themes: { light: 'github-light', dark: 'github-dark' }
      });
      if (selectionId === activeFileSelectionId && selectedFile === path) {
        highlightedFileContent = nextHighlightedContent;
      }
    } catch {
      if (selectionId === activeFileSelectionId && selectedFile === path) {
        highlightedFileContent = '';
      }
    }
  }

  async function selectFile(path: string) {
    if (selectedFile === path) return;

    const selectionId = activeFileSelectionId + 1;
    activeFileSelectionId = selectionId;
    selectedFile = path;
    fileContent = null;
    fileError = null;
    highlightedFileContent = '';

    if (isSkillReadmeFile(path)) {
      fileLoading = false;
      return;
    }

    if (isBinaryFile(path)) {
      fileLoading = false;
      fileError = 'binary';
      return;
    }

    fileLoading = true;

    try {
      let resolvedContent: string | null = null;
      try {
        const directResult = await fetchGitHubFileDirect(path);
        resolvedContent = directResult.content;
      } catch (directError) {
        console.warn('Direct GitHub file fetch failed, fallback to SkillsCat API:', directError);
      }

      if (resolvedContent !== null) {
        if (selectionId !== activeFileSelectionId || selectedFile !== path) return;
        fileContent = resolvedContent;
      } else {
        const fallbackHeaders = consumeClientRateLimitSignalHeaders();
        const response = await fetch(
          `/api/skills/${encodedApiSkillSlug}/file?path=${encodeURIComponent(path)}`,
          fallbackHeaders ? { headers: fallbackHeaders } : undefined
        );

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({ message: 'Failed to load file' })) as { message?: string };
          throw new Error(errorPayload.message || 'Failed to load file');
        }

        const result = await response.json() as { path: string; content: string };
        resolvedContent = result.content;
        if (selectionId !== activeFileSelectionId || selectedFile !== path) return;
        fileContent = resolvedContent;
      }

      if (resolvedContent) {
        void updateHighlightedFileContent(path, resolvedContent, selectionId);
      }
    } catch (error) {
      if (selectionId === activeFileSelectionId && selectedFile === path) {
        fileError = error instanceof Error ? error.message : 'Failed to load file';
      }
    } finally {
      if (selectionId === activeFileSelectionId && selectedFile === path) {
        fileLoading = false;
      }
    }
  }

  function navigateToFile(relativePath: string) {
    if (files.length === 0) return;

    const normalizedPath = relativePath.replace(/^\.\//, '');
    const file = findFile(files, normalizedPath);
    if (!file) return;

    expandParentFolders(file.path);
    void selectFile(file.path);

    requestAnimationFrame(() => {
      const safeSelector = escapeCssSelectorValue(file.path);
      const fileElement = document.querySelector(`[data-file-path="${safeSelector}"]`);
      fileElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  $effect(() => {
    requestedFilePathVersion;
    if (!requestedFilePath) return;
    untrack(() => {
      navigateToFile(requestedFilePath);
    });
  });

  function getFileIconSvg(node: FileNode): string {
    if (node.type === 'directory') {
      const isExpanded = expandedFolders.has(node.path);
      return isExpanded
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M2 10h20"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    }

    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    const name = node.name.toLowerCase();

    if (name === 'skill.md' || name === 'readme.md') {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="#519aba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;
    }

    switch (ext) {
      case 'md':
      case 'mdx':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#519aba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;
      case 'js':
      case 'mjs':
      case 'cjs':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#f7df1e"/><text x="12" y="17" font-size="10" font-weight="bold" fill="#000" text-anchor="middle">JS</text></svg>`;
      case 'ts':
      case 'mts':
      case 'cts':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#3178c6"/><text x="12" y="17" font-size="10" font-weight="bold" fill="#fff" text-anchor="middle">TS</text></svg>`;
      case 'jsx':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#61dafb"/><text x="12" y="17" font-size="9" font-weight="bold" fill="#000" text-anchor="middle">JSX</text></svg>`;
      case 'tsx':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#3178c6"/><text x="12" y="17" font-size="9" font-weight="bold" fill="#fff" text-anchor="middle">TSX</text></svg>`;
      case 'json':
      case 'jsonc':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#cbcb41" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>`;
      case 'css':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#264de4"/><text x="12" y="17" font-size="9" font-weight="bold" fill="#fff" text-anchor="middle">CSS</text></svg>`;
      case 'scss':
      case 'sass':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#cc6699"/><text x="12" y="17" font-size="8" font-weight="bold" fill="#fff" text-anchor="middle">SCSS</text></svg>`;
      case 'html':
      case 'htm':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#e34c26"/><text x="12" y="17" font-size="8" font-weight="bold" fill="#fff" text-anchor="middle">HTML</text></svg>`;
      case 'py':
      case 'pyw':
      case 'pyi':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#3572a5" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`;
      case 'sh':
      case 'bash':
      case 'zsh':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#4eaa25" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 15l3-3-3-3"/><path d="M13 15h4"/></svg>`;
      case 'yaml':
      case 'yml':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#cb171e" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13l2 2 2-2"/><path d="M12 15v3"/></svg>`;
      case 'toml':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#9c4121" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>`;
      case 'env':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#ecd53f" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="12" cy="14" r="3"/></svg>`;
      case 'svg':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#ffb13b" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/></svg>`;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'ico':
      case 'bmp':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#a074c4" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
      case 'go':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#00add8"/><text x="12" y="17" font-size="10" font-weight="bold" fill="#fff" text-anchor="middle">GO</text></svg>`;
      case 'rs':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#dea584" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="12" cy="14" r="3"/></svg>`;
      case 'svelte':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#ff3e00"/><text x="12" y="17" font-size="8" font-weight="bold" fill="#fff" text-anchor="middle">SVE</text></svg>`;
      case 'vue':
        return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" fill="#42b883"/><text x="12" y="17" font-size="8" font-weight="bold" fill="#fff" text-anchor="middle">VUE</text></svg>`;
      case 'dockerfile':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#2496ed" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 13h2v2H7z"/><path d="M11 13h2v2h-2z"/><path d="M15 13h2v2h-2z"/><path d="M11 9h2v2h-2z"/></svg>`;
      case 'gitignore':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#f05032" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/></svg>`;
      case 'lock':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
    }
  }

  function formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div class="card">
  <h2 class="text-lg font-semibold text-fg mb-4">{copy.resources}</h2>
  <div class="file-browser">
    {#snippet renderFileTree(nodes: FileNode[], depth: number = 0)}
      {#each nodes as node (node.path)}
        <div class="file-item" style="padding-left: {Math.min(depth, 8) * 0.75}rem">
          {#if node.type === 'directory'}
            <button
              class="file-row"
              onclick={() => toggleFolder(node.path)}
              title={node.path}
              data-file-path={node.path}
            >
              <span class="file-icon">{@html getFileIconSvg(node)}</span>
              <span class="file-name">{node.name}</span>
              <svg
                class="w-4 h-4 text-fg-muted transition-transform flex-shrink-0 {expandedFolders.has(node.path) ? 'rotate-90' : ''}"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {#if expandedFolders.has(node.path) && node.children}
              {@render renderFileTree(node.children, depth + 1)}
            {/if}
          {:else}
            <button
              class="file-row"
              class:file-row-selected={selectedFile === node.path}
              onclick={() => void selectFile(node.path)}
              title={node.path}
              data-file-path={node.path}
            >
              <span class="file-icon">{@html getFileIconSvg(node)}</span>
              <span class="file-name">{node.name}</span>
              {#if node.size}
                <span class="file-size">{formatFileSize(node.size)}</span>
              {/if}
            </button>
          {/if}
        </div>
      {/each}
    {/snippet}

    {@render renderFileTree(files)}
  </div>

  {#if selectedFile}
    <div class="file-content-viewer">
      <div class="file-content-header">
        <span class="file-content-path">{selectedFile}</span>
        {#if fileContent}
          <CopyButton text={fileContent} size="sm" />
        {/if}
      </div>

      <div class="file-content-body">
        {#if fileLoading}
          <div class="file-loading">
            <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{copy.loadingFile}</span>
          </div>
        {:else if fileError === 'binary'}
          <div class="file-unsupported">
            <svg class="file-unsupported-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span class="file-unsupported-text">{copy.binaryFile}</span>
            <span class="file-unsupported-hint">{copy.binaryFileHint}</span>
          </div>
        {:else if fileError}
          <div class="file-error">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{fileError}</span>
          </div>
        {:else if fileContent}
          {#if highlightedFileContent}
            <div class="file-code-highlighted">
              {@html highlightedFileContent}
            </div>
          {:else}
            <pre class="file-code-plain"><code>{fileContent}</code></pre>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .file-browser {
    max-height: 400px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
  }

  .file-item {
    border-bottom: 1px solid var(--border);
    max-width: 100%;
    overflow: hidden;
  }

  .file-item:last-child {
    border-bottom: none;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    max-width: 100%;
    padding: 0.625rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 0.875rem;
    color: var(--fg);
    transition: background-color 0.15s ease;
    overflow: hidden;
  }

  .file-row:hover {
    background: var(--bg-muted);
  }

  .file-row-selected {
    background: var(--primary-subtle);
    color: var(--primary);
  }

  .file-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-muted);
  }

  .file-icon :global(svg) {
    width: 100%;
    height: 100%;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    font-size: 0.75rem;
    color: var(--fg-muted);
    flex-shrink: 0;
  }

  .file-content-viewer {
    margin-top: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .file-content-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--bg-muted);
    border-bottom: 1px solid var(--border);
  }

  .file-content-path {
    font-size: 0.8125rem;
    font-family: var(--font-mono);
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-content-body {
    min-height: 120px;
    max-height: 500px;
    overflow: auto;
    background: var(--bg-subtle);
  }

  :global(:root.dark) .file-content-body {
    background: #0d1117;
  }

  .file-loading,
  .file-error {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 120px;
    padding: 2rem;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  .file-error {
    color: var(--error);
  }

  .file-unsupported {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 120px;
    padding: 2.5rem 1.5rem;
    text-align: center;
  }

  .file-unsupported-icon {
    width: 3rem;
    height: 3rem;
    color: var(--fg-muted);
    opacity: 0.6;
  }

  .file-unsupported-text {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--fg-muted);
  }

  .file-unsupported-hint {
    font-size: 0.8125rem;
    color: var(--fg-muted);
    opacity: 0.7;
  }

  .file-code-highlighted {
    font-size: 0.8125rem;
    line-height: 1.6;
    tab-size: 2;
    -moz-tab-size: 2;
  }

  .file-code-highlighted :global(pre) {
    margin: 0;
    padding: 1rem;
    font-size: inherit;
    line-height: inherit;
    background: transparent !important;
  }

  .file-code-highlighted :global(.shiki) {
    margin: 0;
    padding: 1rem;
    min-height: 100%;
    background: transparent !important;
  }

  .file-code-plain {
    margin: 0;
    padding: 1rem;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--fg);
  }

  .file-code-plain code {
    font-family: inherit;
  }
</style>
