<script lang="ts">
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import SkillCardCompact from '$lib/components/skill/SkillCardCompact.svelte';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';
  import { toast } from '$lib/components/ui/Toast.svelte';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import VisibilityBadge from '$lib/components/ui/VisibilityBadge.svelte';
  import { getCategoryBySlug } from '$lib/constants/categories';
  import type { SkillDetail, SkillCardData, FileNode } from '$lib/types';
  import type { Highlighter } from 'shiki';

  interface Props {
    data: {
      skill: SkillDetail | null;
      relatedSkills: SkillCardData[];
      error?: string;
      isOwner?: boolean;
      isBookmarked?: boolean;
      isAuthenticated?: boolean;
      isDotFolderSkill?: boolean;
      renderedReadme?: string;
    };
  }

  let { data }: Props = $props();

  // Bookmark state - use local state that syncs with server data
  let bookmarkOverride = $state<boolean | null>(null);
  let isBookmarking = $state(false);
  const isAuthenticated = $derived(data.isAuthenticated ?? false);
  const isBookmarked = $derived(bookmarkOverride ?? data.isBookmarked ?? false);

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
        toast(
          !currentState ? 'Added to bookmarks' : 'Removed from bookmarks',
          'success'
        );
      } else {
        toast('Failed to update bookmark', 'error');
      }
    } catch (err) {
      console.error('Bookmark failed:', err);
      toast('Failed to update bookmark', 'error');
    } finally {
      isBookmarking = false;
    }
  }

  // Shiki highlighter (lazy loaded)
  let highlighter = $state<Highlighter | null>(null);
  let highlightedReadme = $state('');
  let isLoadingShiki = $state(false);

  // Reset highlighted HTML whenever server-rendered markdown changes.
  $effect(() => {
    data.renderedReadme;
    highlightedReadme = '';
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
    if (!highlighter || !data.renderedReadme || highlightedReadme) return;
    void highlightReadmeHtml();
  });

  // Handle clicks on relative file links in markdown content
  $effect(() => {
    function handleFileLinkClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const fileLink = target.closest('.file-link[data-file-path]') as HTMLElement | null;
      if (fileLink) {
        e.preventDefault();
        const filePath = fileLink.dataset.filePath;
        if (filePath) {
          navigateToFile(filePath);
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
      const { createHighlighter } = await import('shiki');
      highlighter = await createHighlighter({
        themes: ['github-dark', 'github-light'],
        langs: [
          'javascript', 'typescript', 'python', 'bash', 'json', 'markdown', 'yaml', 'html', 'css',
          'shell', 'plaintext', 'go', 'rust', 'powershell', 'bat', 'sql', 'toml', 'xml', 'jsx', 'tsx',
          'svelte', 'vue', 'c', 'cpp', 'java', 'kotlin', 'swift', 'ruby', 'php', 'dockerfile'
        ]
      });
      await highlightReadmeHtml();
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

  async function highlightReadmeHtml() {
    if (!highlighter || !data.renderedReadme) return;

    const container = document.createElement('div');
    container.innerHTML = data.renderedReadme;

    const codeBlocks = Array.from(container.querySelectorAll('pre > code')) as HTMLElement[];
    if (codeBlocks.length === 0) {
      highlightedReadme = data.renderedReadme;
      return;
    }

    const supportedLanguages = new Set(highlighter.getLoadedLanguages().map((lang) => String(lang)));
    const BATCH_SIZE = 6;

    for (let i = 0; i < codeBlocks.length; i++) {
      const codeBlock = codeBlocks[i];
      const pre = codeBlock.closest('pre');
      if (!pre || !pre.parentNode) continue;

      const requestedLanguage = getCodeLanguage(codeBlock);
      const language = supportedLanguages.has(requestedLanguage) ? requestedLanguage : 'plaintext';

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
      }
    }

    highlightedReadme = container.innerHTML;
  }

  // Determine the install identifier based on skill type
  const skillIdentifier = $derived(() => {
    if (!data.skill) return '';
    // For private/uploaded skills, use the slug format (owner/name)
    if (data.skill.visibility !== 'public' || data.skill.sourceType === 'upload') {
      return data.skill.slug;
    }
    // For public GitHub skills, use owner/repo format
    return `${data.skill.repoOwner}/${data.skill.repoName}`;
  });

  // Installation command
  const installCommands = $derived(data.skill ? [
    {
      name: 'skillscat',
      label: 'SkillsCat CLI',
      command: `npx skillscat add ${skillIdentifier()}`,
      description: data.skill.visibility === 'private'
        ? 'Requires authentication. Run `skillscat login` first.'
        : 'SkillsCat registry CLI'
    }
  ] : []);

  let selectedInstaller = $state('skillscat');
  const currentCommand = $derived(installCommands.find(c => c.name === selectedInstaller)?.command || '');

  // Download state
  let isDownloading = $state(false);
  let downloadSuccess = $state(false);

  // Download skill files
  async function handleDownload() {
    if (!data.skill || isDownloading) return;
    isDownloading = true;

    try {
      // Check if File System Access API is supported
      if ('showDirectoryPicker' in window) {
        try {
          const dirHandle = await (window as unknown as { showDirectoryPicker: (options: { mode: string; startIn: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
            mode: 'readwrite',
            startIn: 'documents'
          });

          // Fetch all files
          const response = await fetch(`/api/skills/${data.skill.slug}/files`);
          if (!response.ok) {
            if (response.status === 429) {
              toast('Too many requests. Please wait a moment.', 'warning');
              return;
            }
            throw new Error('Failed to fetch files');
          }
          const { folderName, files } = await response.json() as { folderName: string; files: Array<{ path: string; content: string }> };

          // Create skill folder
          const skillDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

          // Write all files
          for (const file of files) {
            // Handle subdirectories
            let targetDir: FileSystemDirectoryHandle = skillDir;
            const pathParts = file.path.split('/');
            const fileName = pathParts.pop();

            // Skip if no filename
            if (!fileName) continue;

            for (const part of pathParts) {
              if (part) {
                targetDir = await targetDir.getDirectoryHandle(part, { create: true });
              }
            }

            const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(file.content);
            await writable.close();
          }

          // Show success - both button state and toast
          downloadSuccess = true;
          toast(`${data.skill.name} installed successfully!`, 'success');
          setTimeout(() => downloadSuccess = false, 3000);
        } catch (err: unknown) {
          // User cancelled the directory picker - not an error
          if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
            return;
          }
          console.error('Download failed:', err);
          fallbackDownload();
        }
      } else {
        fallbackDownload();
      }
    } finally {
      isDownloading = false;
    }
  }

  // Fallback to zip download
  function fallbackDownload() {
    if (!data.skill) return;
    window.location.href = `/api/skills/${data.skill.slug}/download`;
  }

  // Use delayed-highlighted version if available, otherwise server-rendered HTML.
  const renderedReadme = $derived(highlightedReadme || data.renderedReadme || '');

  // File browser state
  let expandedFolders = $state<Set<string>>(new Set());
  let selectedFile = $state<string | null>(null);
  let fileContent = $state<string | null>(null);
  let fileLoading = $state(false);
  let fileError = $state<string | null>(null);
  let highlightedFileContent = $state<string>('');

  function toggleFolder(path: string) {
    const newSet = new Set(expandedFolders);
    if (newSet.has(path)) {
      newSet.delete(path);
    } else {
      newSet.add(path);
    }
    expandedFolders = newSet;
  }

  async function selectFile(path: string) {
    if (selectedFile === path) return;
    selectedFile = path;
    fileContent = null;
    fileError = null;
    highlightedFileContent = '';

    // Check if it's a binary file
    if (isBinaryFile(path)) {
      fileLoading = false;
      fileError = 'binary';
      return;
    }

    fileLoading = true;

    try {
      const res = await fetch(`/api/skills/${data.skill?.slug}/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to load file' })) as { message?: string };
        throw new Error(err.message || 'Failed to load file');
      }
      const result = await res.json() as { path: string; content: string };
      fileContent = result.content;

      // Highlight the content if shiki is loaded
      if (highlighter && fileContent) {
        const ext = path.split('.').pop()?.toLowerCase() || 'plaintext';
        const langMap: Record<string, string> = {
          'js': 'javascript', 'ts': 'typescript', 'py': 'python',
          'sh': 'bash', 'yml': 'yaml', 'md': 'markdown'
        };
        const lang = langMap[ext] || ext;
        try {
          highlightedFileContent = highlighter.codeToHtml(fileContent, {
            lang,
            themes: { light: 'github-light', dark: 'github-dark' }
          });
        } catch {
          // Language not supported, show plain text
          highlightedFileContent = '';
        }
      }
    } catch (err) {
      fileError = err instanceof Error ? err.message : 'Failed to load file';
    } finally {
      fileLoading = false;
    }
  }

  // Expand parent folders for a given file path
  function expandParentFolders(filePath: string) {
    const parts = filePath.split('/');
    const newSet = new Set(expandedFolders);
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      newSet.add(currentPath);
    }
    expandedFolders = newSet;
  }

  // Navigate to a file from a relative link
  function navigateToFile(relativePath: string) {
    if (!data.skill?.fileStructure) return;

    // Normalize the path (remove leading ./)
    let normalizedPath = relativePath.replace(/^\.\//, '');

    // Find the file in the file structure
    function findFile(nodes: FileNode[], targetPath: string): FileNode | null {
      for (const node of nodes) {
        if (node.path === targetPath || node.path.endsWith('/' + targetPath) || node.path === targetPath.replace(/^\//, '')) {
          return node;
        }
        if (node.children) {
          const found = findFile(node.children, targetPath);
          if (found) return found;
        }
      }
      return null;
    }

    const file = findFile(data.skill.fileStructure, normalizedPath);
    if (file) {
      expandParentFolders(file.path);
      selectFile(file.path);

      // Scroll to the file in the file browser after DOM updates
      requestAnimationFrame(() => {
        const safeSelector = escapeCssSelectorValue(file.path);
        const fileElement = document.querySelector(`[data-file-path="${safeSelector}"]`);
        if (fileElement) {
          fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }
  }

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

  // SVG icons for different file types (VS Code style)
  function getFileIconSvg(node: FileNode): string {
    if (node.type === 'directory') {
      const isExpanded = expandedFolders.has(node.path);
      return isExpanded
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M2 10h20"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    }

    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    const name = node.name.toLowerCase();

    // Special files
    if (name === 'skill.md' || name === 'readme.md') {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="#519aba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;
    }

    // By extension
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

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
    return `${Math.floor(seconds / 2592000)}mo ago`;
  }

  // Get author profile URL
  function getAuthorProfileUrl(): string {
    if (!data.skill) return '#';
    if (data.skill.orgSlug) return `/org/${data.skill.orgSlug}`;
    if (data.skill.ownerName) return `/u/${data.skill.ownerName}`;
    if (data.skill.authorUsername) return `/u/${data.skill.authorUsername}`;
    return `https://github.com/${data.skill.repoOwner}`;
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

  // Check if author link is external
  function isAuthorExternal(): boolean {
    if (!data.skill) return false;
    return !data.skill.orgSlug && !data.skill.ownerName && !data.skill.authorUsername;
  }

  // Highlight command syntax
  function highlightCommand(command: string): string {
    // Parse: $ npx skillscat add owner/repo
    const parts = command.split(' ');
    const highlighted: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === 'npx') {
        highlighted.push(`<span class="cmd-npx">${escapeHtml(part)}</span>`);
      } else if (part === 'skillscat') {
        highlighted.push(`<span class="cmd-tool">${escapeHtml(part)}</span>`);
      } else if (part === 'add') {
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
</script>

<svelte:head>
  {#if data.skill}
    <title>{data.skill.name} - SkillsCat</title>
    <meta name="description" content={data.skill.description || `AI agent skill: ${data.skill.name}`} />
    {#if data.skill.visibility !== 'public'}
      <meta name="robots" content="noindex, nofollow" />
    {/if}
    <meta property="og:title" content="{data.skill.name} - SkillsCat" />
    <meta property="og:description" content={data.skill.description || ''} />
  {:else}
    <title>Skill Not Found - SkillsCat</title>
  {/if}
</svelte:head>

{#if data.skill}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
    <!-- Breadcrumb -->
    <nav class="breadcrumb">
      <ol>
        <li class="breadcrumb-fixed hide-mobile"><a href="/">Home</a></li>
        <li class="breadcrumb-sep hide-mobile">/</li>
        <li class="breadcrumb-fixed"><a href="/trending">Skills</a></li>
        <li class="breadcrumb-sep">/</li>
        <li class="breadcrumb-truncate">
          <a
            href={getAuthorProfileUrl()}
            target={isAuthorExternal() ? '_blank' : undefined}
            rel={isAuthorExternal() ? 'noopener noreferrer' : undefined}
          >
            {getAuthorDisplayName()}
          </a>
        </li>
        <li class="breadcrumb-sep">/</li>
        <li class="breadcrumb-truncate breadcrumb-current">{data.skill.name}</li>
      </ol>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Main Content -->
      <div class="lg:col-span-2 space-y-8">
        <!-- Header -->
        <div class="card skill-header">
          <!-- Top row: Avatar + Title -->
          <div class="flex items-center gap-3 mb-3">
            <!-- Avatar: clickable, links to author profile -->
            <a
              href={getAuthorProfileUrl()}
              target={isAuthorExternal() ? '_blank' : undefined}
              rel={isAuthorExternal() ? 'noopener noreferrer' : undefined}
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

            <!-- Title + Bookmark -->
            <div class="flex-1 min-w-0 flex items-center gap-3">
              <h1 class="skill-title-inline flex-1">{data.skill.name}</h1>
              {#if isAuthenticated}
                <button
                  class="bookmark-btn"
                  class:bookmarked={isBookmarked}
                  onclick={handleBookmark}
                  disabled={isBookmarking}
                  aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                >
                  <svg class="w-6 h-6" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
              {/if}
            </div>
          </div>

          <!-- Description (full width) -->
          <p class="skill-description-full">{data.skill.description || 'No description provided'}</p>

          <!-- Meta row with badges -->
          <div class="skill-meta">
            <!-- Badges first -->
            {#if data.skill.visibility !== 'public'}
              <VisibilityBadge visibility={data.skill.visibility} size="md" />
            {/if}
            {#if data.skill.sourceType === 'upload'}
              <span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                uploaded
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
                href="/u/{data.skill.ownerName}"
                class="skill-meta-item"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {data.skill.ownerName}
              </a>
            {:else if data.skill.repoOwner}
              <a
                href="https://github.com/{data.skill.repoOwner}"
                target="_blank"
                rel="noopener noreferrer"
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
                {data.skill.stars.toLocaleString()}
              </span>
              {#if data.skill.forks}
                <span class="skill-meta-item">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {data.skill.forks}
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
              Updated {formatRelativeTime(data.skill.updatedAt)}
            </span>
          </div>
        </div>

        <!-- File Browser (show above SKILL.md when files exist) -->
        {#if data.skill.fileStructure && data.skill.fileStructure.length > 0}
          <div class="card">
            <h2 class="text-lg font-semibold text-fg mb-4">Files</h2>
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
                        onclick={() => selectFile(node.path)}
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
              {@render renderFileTree(data.skill.fileStructure)}
            </div>

            <!-- File Content Viewer -->
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
                      <span>Loading...</span>
                    </div>
                  {:else if fileError === 'binary'}
                    <div class="file-unsupported">
                      <svg class="file-unsupported-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span class="file-unsupported-text">Binary file - preview not available</span>
                      <span class="file-unsupported-hint">Download the skill to view this file</span>
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
        {/if}

        <!-- SKILL.md Content -->
        {#if data.skill.readme}
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
          <div class="card">
            <h2 class="text-lg font-semibold text-fg mb-4">Categories</h2>
            <div class="flex flex-wrap gap-2">
              {#each data.skill.categories as categorySlug}
                {@const category = getCategoryBySlug(categorySlug)}
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
      <div class="space-y-6">
        <!-- Actions -->
        <div class="card">
          <div class="space-y-3">
            <button onclick={handleDownload} class="download-btn" disabled={isDownloading}>
              {#if downloadSuccess}
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                Installed!
              {:else if isDownloading}
                <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Installing...
              {:else}
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Skill
              {/if}
            </button>
            {#if data.skill.githubUrl}
              <a href={data.skill.githubUrl} target="_blank" rel="noopener noreferrer" class="github-btn">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                View on GitHub
              </a>
            {/if}
          </div>
        </div>

        <!-- Install by CLI -->
        <div class="card">
          <h3 class="font-semibold text-fg mb-4">Install by CLI</h3>

          <!-- CLI Switcher -->
          <div class="cli-switcher">
            {#each installCommands as installer (installer.name)}
              <button
                class="cli-switcher-btn"
                class:active={selectedInstaller === installer.name}
                onclick={() => selectedInstaller = installer.name}
              >
                {installer.label}
              </button>
            {/each}
            <div
              class="cli-switcher-indicator"
              style="transform: translateX({installCommands.findIndex(c => c.name === selectedInstaller) * 100}%)"
            ></div>
          </div>

          <!-- Command -->
          <div class="command-box">
            <code class="command-text">{@html highlightedCommand}</code>
            <CopyButton text={currentCommand} size="sm" />
          </div>

          <!-- Description -->
          <p class="command-description">
            {installCommands.find(c => c.name === selectedInstaller)?.description}
          </p>
        </div>

        <!-- Private Skill Notice -->
        {#if data.skill.visibility === 'private'}
          <div class="card bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div>
                <h4 class="font-medium text-yellow-800 dark:text-yellow-200">Private Skill</h4>
                <p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  This skill is private. To install it, you need to authenticate with the CLI first:
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
                <h4 class="font-medium text-blue-800 dark:text-blue-200">Repository Stars</h4>
                <p class="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  The star count shown is for the parent repository ({data.skill.repoOwner}/{data.skill.repoName}), not this specific skill.
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

        <!-- Related Skills -->
        {#if data.relatedSkills.length > 0}
          <div class="card">
            <h3 class="font-semibold text-fg mb-4">Related Skills</h3>
            <div class="space-y-3">
              {#each data.relatedSkills as relatedSkill (relatedSkill.id)}
                <SkillCardCompact skill={relatedSkill} />
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <!-- Not Found -->
  <ErrorState
    code={404}
    title="Skill Not Found"
    message={data.error || "The skill you're looking for doesn't exist or has been removed."}
    fullPage
    primaryActionText="Browse Skills"
    primaryActionHref="/trending"
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

  /* Bookmark Button */
  .bookmark-btn {
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

  .bookmark-btn:hover {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-subtle);
  }

  .bookmark-btn.bookmarked {
    color: var(--primary);
    background: var(--primary-subtle);
    border-color: var(--primary);
  }

  .bookmark-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  /* File Browser Styles */
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

  /* File Content Viewer */
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

  :root.dark .file-content-body {
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

  /* Binary file unsupported preview */
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
    background: transparent !important;
    overflow-x: auto;
  }

  .file-code-highlighted :global(code) {
    font-family: var(--font-mono);
  }

  /* Dark mode: use GitHub dark theme background */
  :root.dark .file-code-highlighted :global(.shiki),
  :root.dark .file-code-highlighted :global(pre) {
    background: #0d1117 !important;
  }

  :root.dark .file-code-highlighted :global(.shiki span) {
    color: var(--shiki-dark) !important;
  }

  .file-code-plain {
    margin: 0;
    padding: 1rem;
    font-size: 0.8125rem;
    line-height: 1.6;
    overflow-x: auto;
    white-space: pre;
    tab-size: 2;
    -moz-tab-size: 2;
  }

  .file-code-plain code {
    font-family: var(--font-mono);
    color: var(--fg);
  }

  /* Download Button */
  .download-btn {
    --btn-shadow-offset: 4px;
    --btn-shadow-color: oklch(50% 0.22 55);

    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
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
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
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
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg);
    border-radius: var(--radius-lg);
    border: 2px solid var(--border);
    font-family: var(--font-mono);
  }

  :root:not(.dark) .command-box {
    background: #fafafa;
    border-color: #e5e5e5;
  }

  .command-text {
    flex: 1;
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
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
  }

  .prose-readme :global(th),
  .prose-readme :global(td) {
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    text-align: left;
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

    .skill-content-card {
      padding: 1.25rem;
    }

    .skill-content-divider {
      margin-bottom: 1rem;
    }
  }
</style>
