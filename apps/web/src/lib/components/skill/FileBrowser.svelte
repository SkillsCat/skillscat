<script lang="ts">
  /**
   * FileBrowser - 文件浏览器组件
   * 展示 skill 目录的树状结构
   */

  interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    size?: number;
    children?: FileNode[];
  }

  interface Props {
    files: FileNode[];
    selectedPath?: string;
    onSelect?: (path: string, type: 'file' | 'dir') => void;
  }

  let { files, selectedPath = '', onSelect }: Props = $props();

  let expandedDirs = $state<Set<string>>(new Set());

  function toggleDir(path: string) {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    expandedDirs = newExpanded;
  }

  function handleSelect(node: FileNode) {
    if (node.type === 'dir') {
      toggleDir(node.path);
    }
    // Toggle selection: clicking selected file unselects it
    const newPath = selectedPath === node.path ? '' : node.path;
    onSelect?.(newPath, node.type);
  }

  function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(name: string, type: 'file' | 'dir'): string {
    if (type === 'dir') return '📁';

    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md':
        return '📝';
      case 'ts':
      case 'tsx':
        return '🔷';
      case 'js':
      case 'jsx':
        return '🟨';
      case 'json':
        return '📋';
      case 'yaml':
      case 'yml':
        return '⚙️';
      case 'py':
        return '🐍';
      case 'rs':
        return '🦀';
      case 'go':
        return '🐹';
      case 'sh':
      case 'bash':
        return '💻';
      case 'css':
      case 'scss':
      case 'less':
        return '🎨';
      case 'html':
        return '🌐';
      case 'svg':
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
        return '🖼️';
      default:
        return '📄';
    }
  }

  function sortFiles(nodes: FileNode[]): FileNode[] {
    return [...nodes].sort((a, b) => {
      // Directories first
      if (a.type !== b.type) {
        return a.type === 'dir' ? -1 : 1;
      }
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  }
</script>

<div class="file-browser">
  {#snippet renderNode(node: FileNode, depth: number = 0)}
    {@const isExpanded = expandedDirs.has(node.path)}
    {@const isSelected = selectedPath === node.path}

    <button
      type="button"
      class="file-item"
      class:selected={isSelected}
      style="padding-left: {depth * 16 + 8}px"
      onclick={() => handleSelect(node)}
    >
      {#if node.type === 'dir'}
        <span class="expand-icon" class:expanded={isExpanded}>
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      {:else}
        <span class="expand-icon-placeholder"></span>
      {/if}

      <span class="file-icon">{getFileIcon(node.name, node.type)}</span>
      <span class="file-name">{node.name}</span>

      {#if node.type === 'file' && node.size}
        <span class="file-size">{formatSize(node.size)}</span>
      {/if}
    </button>

    {#if node.type === 'dir' && isExpanded && node.children}
      {#each sortFiles(node.children) as child (child.path)}
        {@render renderNode(child, depth + 1)}
      {/each}
    {/if}
  {/snippet}

  {#each sortFiles(files) as node (node.path)}
    {@render renderNode(node)}
  {/each}
</div>

<style>
  .file-browser {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.875rem;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.375rem 0.5rem;
    border: none;
    background: transparent;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
    border-radius: 0.375rem;
    transition: background-color 0.15s;
  }

  .file-item:hover {
    background-color: var(--card);
  }

  .file-item.selected {
    background-color: var(--primary-subtle);
    color: var(--primary);
  }

  .expand-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    transition: transform 0.15s;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  .expand-icon-placeholder {
    width: 1rem;
    height: 1rem;
  }

  .file-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }
</style>
