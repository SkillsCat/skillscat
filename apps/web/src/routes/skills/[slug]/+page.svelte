<script lang="ts">
  import { CopyButton, Button, Section, Grid, SkillCard, SkillCardCompact, EmptyState, toast } from '$lib/components';
  import { getCategoryBySlug } from '$lib/constants/categories';
  import { marked } from 'marked';
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

  // Load shiki on mount
  $effect(() => {
    if (data.skill?.readme && !highlighter) {
      loadShiki();
    }
  });

  async function loadShiki() {
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
      await highlightReadme();
    } catch (e) {
      console.error('Failed to load shiki:', e);
    }
  }

  // Strip frontmatter from markdown
  function stripFrontmatter(content: string): string {
    const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
    return content.replace(frontmatterRegex, '');
  }

  // Custom marked renderer with shiki highlighting
  async function highlightReadme() {
    if (!data.skill?.readme || !highlighter) return;

    const strippedReadme = stripFrontmatter(data.skill.readme);

    const renderer = new marked.Renderer();

    renderer.code = function({ text, lang }: { text: string; lang?: string }) {
      const language = lang || 'plaintext';
      // Extract filename if present (e.g., "js:filename.js" or just "filename.js")
      let filename = '';
      let actualLang = language;

      if (language.includes(':')) {
        const parts = language.split(':');
        actualLang = parts[0];
        filename = parts[1];
      } else if (language.includes('.')) {
        // If it looks like a filename, extract extension
        filename = language;
        const ext = language.split('.').pop()?.toLowerCase() || '';
        const extToLang: Record<string, string> = {
          // JavaScript variants
          'js': 'javascript',
          'mjs': 'javascript',
          'cjs': 'javascript',
          'jsx': 'jsx',
          // TypeScript variants
          'ts': 'typescript',
          'mts': 'typescript',
          'cts': 'typescript',
          'tsx': 'tsx',
          // Python
          'py': 'python',
          'pyw': 'python',
          'pyi': 'python',
          // Rust
          'rs': 'rust',
          // Go
          'go': 'go',
          // Shell/Bash
          'sh': 'bash',
          'bash': 'bash',
          'zsh': 'bash',
          // PowerShell
          'ps1': 'powershell',
          'psm1': 'powershell',
          'psd1': 'powershell',
          // Windows batch/cmd
          'bat': 'bat',
          'cmd': 'bat',
          // Config files
          'yml': 'yaml',
          'yaml': 'yaml',
          'toml': 'toml',
          'json': 'json',
          'jsonc': 'json',
          // Markup
          'md': 'markdown',
          'mdx': 'markdown',
          'html': 'html',
          'htm': 'html',
          'xml': 'xml',
          'svg': 'xml',
          // Styles
          'css': 'css',
          'scss': 'css',
          'sass': 'css',
          'less': 'css',
          // Other languages
          'sql': 'sql',
          'c': 'c',
          'h': 'c',
          'cpp': 'cpp',
          'cc': 'cpp',
          'cxx': 'cpp',
          'hpp': 'cpp',
          'java': 'java',
          'kt': 'kotlin',
          'kts': 'kotlin',
          'swift': 'swift',
          'rb': 'ruby',
          'php': 'php',
          'svelte': 'svelte',
          'vue': 'vue',
          'dockerfile': 'dockerfile',
        };
        actualLang = extToLang[ext] || ext || 'plaintext';
      }

      try {
        const supportedLangs = highlighter!.getLoadedLanguages();
        const langToUse = supportedLangs.includes(actualLang) ? actualLang : 'plaintext';
        const codeHtml = highlighter!.codeToHtml(text, {
          lang: langToUse,
          themes: { light: 'github-light', dark: 'github-dark' }
        });

        if (filename) {
          return `<div class="code-block-wrapper"><div class="code-block-header"><span>${filename}</span></div>${codeHtml}</div>`;
        }
        return codeHtml;
      } catch {
        const escapedText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (filename) {
          return `<div class="code-block-wrapper"><div class="code-block-header"><span>${filename}</span></div><pre><code class="language-${actualLang}">${escapedText}</code></pre></div>`;
        }
        return `<pre><code class="language-${actualLang}">${escapedText}</code></pre>`;
      }
    };

    marked.setOptions({ renderer });
    highlightedReadme = await marked.parse(strippedReadme);
  }

  // Determine the install identifier based on skill type
  const skillIdentifier = $derived(() => {
    if (!data.skill) return '';
    // For private/uploaded skills, use the slug format (@owner/name)
    if (data.skill.visibility !== 'public' || data.skill.sourceType === 'upload') {
      return data.skill.slug;
    }
    // For public GitHub skills, use owner/repo format
    return `${data.skill.repoOwner}/${data.skill.repoName}`;
  });

  // Installation commands for different CLI tools
  const installCommands = $derived(data.skill ? [
    {
      name: 'skillscat',
      label: 'SkillsCat CLI',
      command: `npx skillscat add ${skillIdentifier()}`,
      description: data.skill.visibility === 'private'
        ? 'Requires authentication. Run `skillscat login` first.'
        : 'SkillsCat registry CLI'
    },
    ...(data.skill.sourceType === 'github' && data.skill.visibility === 'public' ? [{
      name: 'add-skill',
      label: 'Vercel add-skill',
      command: `npx add-skill ${data.skill.repoOwner}/${data.skill.repoName}`,
      description: 'Works with Claude Code, Cursor, Codex, and 10+ agents'
    }] : [])
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

  // Fallback rendered README (without shiki)
  const fallbackReadme = $derived(() => {
    if (!data.skill?.readme) return '';
    const stripped = stripFrontmatter(data.skill.readme);
    return marked.parse(stripped, { async: false });
  });

  // Use highlighted version if available, otherwise fallback
  const renderedReadme = $derived(highlightedReadme || fallbackReadme());

  // File browser state
  let expandedFolders = $state<Set<string>>(new Set());
  let selectedFile = $state<string | null>(null);

  function toggleFolder(path: string) {
    const newSet = new Set(expandedFolders);
    if (newSet.has(path)) {
      newSet.delete(path);
    } else {
      newSet.add(path);
    }
    expandedFolders = newSet;
  }

  function selectFile(path: string) {
    selectedFile = path;
  }

  function getFileIcon(node: FileNode): string {
    if (node.type === 'directory') {
      return expandedFolders.has(node.path) ? '📂' : '📁';
    }
    const ext = node.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md': return '📝';
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx': return '📜';
      case 'json': return '📋';
      case 'css':
      case 'scss': return '🎨';
      case 'html': return '🌐';
      case 'py': return '🐍';
      case 'sh': return '⚙️';
      default: return '📄';
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

  // Get visibility badge color
  function getVisibilityColor(visibility: string): string {
    switch (visibility) {
      case 'private': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'unlisted': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      default: return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    }
  }

  // Get author profile URL
  function getAuthorProfileUrl(): string {
    if (!data.skill) return '#';
    if (data.skill.orgSlug) return `/org/${data.skill.orgSlug}`;
    if (data.skill.ownerName) return `/u/${data.skill.ownerName}`;
    if (data.skill.authorUsername) return `/u/${data.skill.authorUsername}`;
    return `https://github.com/${data.skill.repoOwner}`;
  }

  // Get author avatar URL
  function getAuthorAvatarUrl(): string {
    if (!data.skill) return '';
    if (data.skill.orgAvatar) return data.skill.orgAvatar;
    if (data.skill.ownerAvatar) return data.skill.ownerAvatar;
    if (data.skill.authorAvatar) return data.skill.authorAvatar;
    return `https://github.com/${data.skill.repoOwner}.png`;
  }

  // Get author display name
  function getAuthorDisplayName(): string {
    if (!data.skill) return '';
    if (data.skill.orgName) return data.skill.orgName;
    if (data.skill.ownerName) return data.skill.ownerName;
    if (data.skill.authorDisplayName) return data.skill.authorDisplayName;
    if (data.skill.authorUsername) return data.skill.authorUsername;
    return data.skill.repoOwner;
  }

  // Check if author link is external
  function isAuthorExternal(): boolean {
    if (!data.skill) return false;
    return !data.skill.orgSlug && !data.skill.ownerName && !data.skill.authorUsername;
  }

  // Highlight command syntax
  function highlightCommand(command: string): string {
    // Parse: $ npx skillscat add owner/repo
    // or: $ npx add-skill owner/repo
    const parts = command.split(' ');
    const highlighted: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === 'npx') {
        highlighted.push(`<span class="cmd-npx">${part}</span>`);
      } else if (part === 'skillscat' || part === 'add-skill') {
        highlighted.push(`<span class="cmd-tool">${part}</span>`);
      } else if (part === 'add') {
        highlighted.push(`<span class="cmd-action">${part}</span>`);
      } else if (part.includes('/')) {
        // owner/repo format
        highlighted.push(`<span class="cmd-repo">${part}</span>`);
      } else {
        highlighted.push(`<span class="cmd-default">${part}</span>`);
      }
    }

    return highlighted.join(' ');
  }

  const highlightedCommand = $derived(highlightCommand(currentCommand));
</script>

<svelte:head>
  {#if data.skill}
    <title>{data.skill.name} - SkillsCat</title>
    <meta name="description" content={data.skill.description || `Claude Code skill: ${data.skill.name}`} />
    <meta property="og:title" content="{data.skill.name} - SkillsCat" />
    <meta property="og:description" content={data.skill.description || ''} />
  {:else}
    <title>Skill Not Found - SkillsCat</title>
  {/if}
</svelte:head>

{#if data.skill}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Breadcrumb -->
    <nav class="mb-6 text-sm">
      <ol class="flex items-center gap-2 text-fg-muted">
        <li><a href="/" class="hover:text-primary transition-colors">Home</a></li>
        <li>/</li>
        <li><a href="/trending" class="hover:text-primary transition-colors">Skills</a></li>
        <li>/</li>
        <li class="text-fg font-medium">{data.skill.name}</li>
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
              {#if data.skill.orgAvatar}
                <img
                  src={data.skill.orgAvatar}
                  alt={data.skill.orgName}
                  class="w-12 h-12 rounded-xl border-2 border-border"
                />
              {:else if data.skill.ownerAvatar}
                <img
                  src={data.skill.ownerAvatar}
                  alt={data.skill.ownerName}
                  class="w-12 h-12 rounded-xl border-2 border-border"
                />
              {:else if data.skill.repoOwner}
                <img
                  src={`https://github.com/${data.skill.repoOwner}.png`}
                  alt={data.skill.repoOwner}
                  class="w-12 h-12 rounded-xl border-2 border-border"
                />
              {:else}
                <div class="w-12 h-12 rounded-xl border-2 border-border bg-primary flex items-center justify-center text-white text-lg font-bold">
                  {data.skill.name[0].toUpperCase()}
                </div>
              {/if}
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
              <span class="px-2.5 py-1 text-xs font-semibold rounded-full {getVisibilityColor(data.skill.visibility)}">
                {data.skill.visibility}
              </span>
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

        <!-- SKILL.md Content (priority over File Browser) -->
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
        {:else if data.skill.fileStructure && data.skill.fileStructure.length > 0}
          <!-- File Browser (only show when no readme) -->
          <div class="card">
            <h2 class="text-lg font-semibold text-fg mb-4">Files</h2>
            <div class="file-browser">
              {#snippet renderFileTree(nodes: FileNode[], depth: number = 0)}
                {#each nodes as node (node.path)}
                  <div class="file-item" style="padding-left: {depth * 1.25}rem">
                    {#if node.type === 'directory'}
                      <button
                        class="file-row"
                        onclick={() => toggleFolder(node.path)}
                      >
                        <span class="file-icon">{getFileIcon(node)}</span>
                        <span class="file-name">{node.name}</span>
                        <svg
                          class="w-4 h-4 text-fg-muted transition-transform {expandedFolders.has(node.path) ? 'rotate-90' : ''}"
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
                      >
                        <span class="file-icon">{getFileIcon(node)}</span>
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
  <div class="not-found-page">
    <div class="not-found-content">
      <div class="not-found-icon">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h1 class="not-found-code">404</h1>
      <h2 class="not-found-title">Skill Not Found</h2>
      <p class="not-found-message">
        {data.error || "The skill you're looking for doesn't exist or has been removed."}
      </p>
      <div class="not-found-actions">
        <Button variant="cute" href="/trending">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
          </svg>
          Browse Skills
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
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

  .avatar-link img,
  .avatar-link > div {
    transition: border-color 0.2s ease;
  }

  .avatar-link:hover img,
  .avatar-link:hover > div {
    border-color: var(--primary);
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

  .skill-description-inline {
    font-size: 0.9375rem;
    color: var(--fg-muted);
    line-height: 1.5;
    margin-top: 0.25rem;
  }

  .skill-description-full {
    font-size: 0.9375rem;
    color: var(--fg-muted);
    line-height: 1.6;
    margin-bottom: 1rem;
  }

  .skill-title {
    font-size: clamp(1.75rem, 4vw, 2.25rem);
    font-weight: 800;
    color: var(--fg);
    line-height: 1.2;
    margin-bottom: 0.75rem;
    letter-spacing: -0.02em;
  }

  .skill-description {
    font-size: 1.0625rem;
    color: var(--fg-muted);
    line-height: 1.6;
    margin-bottom: 1.25rem;
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
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
  }

  .file-item {
    border-bottom: 1px solid var(--border);
  }

  .file-item:last-child {
    border-bottom: none;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 0.875rem;
    color: var(--fg);
    transition: background-color 0.15s ease;
  }

  .file-row:hover {
    background: var(--bg-muted);
  }

  .file-row-selected {
    background: var(--primary-subtle);
    color: var(--primary);
  }

  .file-icon {
    font-size: 1rem;
    flex-shrink: 0;
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
    --switcher-shadow: 3px;
    position: relative;
    display: inline-flex;
    padding: 4px;
    background: var(--bg-subtle);
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    margin-bottom: 1rem;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
  }

  .cli-switcher-btn {
    position: relative;
    z-index: 1;
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: color 0.2s ease;
    white-space: nowrap;
  }

  .cli-switcher-btn:hover {
    color: var(--foreground);
  }

  .cli-switcher-btn.active {
    color: white;
  }

  .cli-switcher-indicator {
    position: absolute;
    top: 4px;
    left: 4px;
    width: calc(50% - 4px);
    height: calc(100% - 8px);
    background: var(--primary);
    border-radius: var(--radius-full);
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

  :root.dark .prose-readme :global(.shiki),
  :root.dark .prose-readme :global(.shiki span) {
    color: var(--shiki-dark) !important;
    background-color: var(--shiki-dark-bg) !important;
  }

  .prose-readme :global(ul),
  .prose-readme :global(ol) {
    margin: 1em 0;
    padding-left: 1.5em;
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

  /* Not Found Page Styles */
  .not-found-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 12rem);
    padding: 2rem;
  }

  .not-found-content {
    text-align: center;
    max-width: 28rem;
  }

  .not-found-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 5rem;
    height: 5rem;
    margin: 0 auto 1.5rem;
    background: linear-gradient(135deg, var(--primary-subtle) 0%, rgba(var(--accent-rgb), 0.1) 100%);
    border: 2px solid var(--primary);
    border-radius: var(--radius-xl);
    color: var(--primary);
  }

  .not-found-icon svg {
    width: 2.5rem;
    height: 2.5rem;
  }

  .not-found-code {
    font-size: clamp(4rem, 10vw, 7rem);
    font-weight: 900;
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    margin-bottom: 0.5rem;
  }

  .not-found-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--fg);
    margin-bottom: 0.75rem;
  }

  .not-found-message {
    font-size: 0.9375rem;
    color: var(--fg-muted);
    margin-bottom: 2rem;
    line-height: 1.6;
  }

  .not-found-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
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
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }

    .command-text {
      padding-bottom: 0.5rem;
    }

    .skill-content-card {
      padding: 1.25rem;
    }

    .skill-content-divider {
      margin-bottom: 1rem;
    }
  }
</style>
