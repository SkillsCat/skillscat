<script lang="ts">
  /**
   * InstallDialog - 安装对话框组件
   * 支持 File System Access API、命令复制、打包下载
   */
  import { CopyButton, Button } from '$lib/components';

  interface Props {
    skillName: string;
    repoOwner: string;
    repoName: string;
    skillPath?: string;
    isOpen?: boolean;
    onClose?: () => void;
  }

  let {
    skillName,
    repoOwner,
    repoName,
    skillPath = '',
    isOpen = false,
    onClose,
  }: Props = $props();

  type InstallTarget = 'claude' | 'cursor' | 'codex' | 'custom';
  type Platform = 'mac' | 'linux' | 'windows' | 'unknown';

  let selectedTarget = $state<InstallTarget>('claude');
  let isInstalling = $state(false);
  let installError = $state<string | null>(null);

  // Detect platform
  const platform = $derived<Platform>(() => {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'windows';
    if (ua.includes('mac')) return 'mac';
    if (ua.includes('linux')) return 'linux';
    return 'unknown';
  });

  // Check if File System Access API is supported
  const supportsFileSystem = $derived(
    typeof window !== 'undefined' && 'showDirectoryPicker' in window
  );

  // Check if mobile
  const isMobile = $derived(
    typeof navigator !== 'undefined' &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );

  // Generate install paths based on target
  const installPaths: Record<InstallTarget, string> = {
    claude: '~/.claude/skills',
    cursor: '~/.cursor/skills',
    codex: '~/.codex/skills',
    custom: '',
  };

  // Generate commands
  const githubRawUrl = $derived(
    `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/${skillPath}`
  );

  const curlCommand = $derived(
    `curl -fsSL ${githubRawUrl}/SKILL.md -o ${installPaths[selectedTarget]}/${skillName}/SKILL.md`
  );

  const wgetCommand = $derived(
    `wget -qO ${installPaths[selectedTarget]}/${skillName}/SKILL.md ${githubRawUrl}/SKILL.md`
  );

  const powershellCommand = $derived(
    `Invoke-WebRequest -Uri "${githubRawUrl}/SKILL.md" -OutFile "$env:USERPROFILE\\.claude\\skills\\${skillName}\\SKILL.md"`
  );

  const targets: { id: InstallTarget; name: string; icon: string }[] = [
    { id: 'claude', name: 'Claude Code', icon: '🤖' },
    { id: 'cursor', name: 'Cursor', icon: '📝' },
    { id: 'codex', name: 'Codex', icon: '💻' },
  ];

  async function handleInstall() {
    if (!supportsFileSystem) return;

    isInstalling = true;
    installError = null;

    try {
      // Request directory access
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });

      // Create skill directory
      const skillDirHandle = await dirHandle.getDirectoryHandle(skillName, { create: true });

      // Fetch and write SKILL.md
      const response = await fetch(`/api/skills/${repoOwner}-${repoName}/download`);
      if (!response.ok) {
        throw new Error('Failed to fetch skill files');
      }

      const files = await response.json();

      for (const file of files) {
        const fileHandle = await skillDirHandle.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file.content);
        await writable.close();
      }

      onClose?.();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User cancelled
        return;
      }
      installError = error.message || 'Installation failed';
    } finally {
      isInstalling = false;
    }
  }

  function handleClose() {
    onClose?.();
  }
</script>

{#if isOpen}
  <div class="dialog-overlay" onclick={handleClose} role="presentation">
    <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div class="dialog-header">
        <h2 class="dialog-title">Install {skillName}</h2>
        <button type="button" class="dialog-close" onclick={handleClose} aria-label="Close">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="dialog-content">
        <!-- Target Selection -->
        <div class="section">
          <label class="section-label">Install for</label>
          <div class="target-grid">
            {#each targets as target (target.id)}
              <button
                type="button"
                class="target-btn"
                class:selected={selectedTarget === target.id}
                onclick={() => selectedTarget = target.id}
              >
                <span class="target-icon">{target.icon}</span>
                <span class="target-name">{target.name}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Install Button (if File System API supported) -->
        {#if supportsFileSystem && !isMobile}
          <div class="section">
            <Button
              variant="primary"
              class="w-full"
              onclick={handleInstall}
              disabled={isInstalling}
            >
              {#if isInstalling}
                <svg class="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Installing...
              {:else}
                <svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Install to Local Directory
              {/if}
            </Button>
            {#if installError}
              <p class="error-text">{installError}</p>
            {/if}
          </div>
        {/if}

        <!-- Command Copy -->
        <div class="section">
          <label class="section-label">Or copy command</label>

          {#if platform === 'windows'}
            <div class="command-box">
              <div class="command-label">PowerShell</div>
              <div class="command-content">
                <code>{powershellCommand}</code>
                <CopyButton text={powershellCommand} />
              </div>
            </div>
          {:else}
            <div class="command-box">
              <div class="command-label">curl</div>
              <div class="command-content">
                <code>{curlCommand}</code>
                <CopyButton text={curlCommand} />
              </div>
            </div>

            <div class="command-box">
              <div class="command-label">wget</div>
              <div class="command-content">
                <code>{wgetCommand}</code>
                <CopyButton text={wgetCommand} />
              </div>
            </div>
          {/if}
        </div>

        <!-- Download Button (desktop only) -->
        {#if !isMobile}
          <div class="section">
            <a
              href="/api/skills/{repoOwner}-{repoName}/download?format=zip"
              class="btn btn-secondary w-full flex items-center justify-center gap-2"
              download="{skillName}.zip"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download as ZIP
            </a>
          </div>
        {/if}

        <!-- GitHub Link -->
        <div class="section github-section">
          <p class="github-text">
            Like this skill? Give it a ⭐ on GitHub!
          </p>
          <a
            href="https://github.com/{repoOwner}/{repoName}"
            target="_blank"
            rel="noopener noreferrer"
            class="github-link"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Star on GitHub
          </a>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }

  .dialog {
    width: 100%;
    max-width: 28rem;
    max-height: 90vh;
    overflow-y: auto;
    background-color: var(--color-bg);
    border-radius: 1rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--color-border);
  }

  .dialog-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-fg);
  }

  .dialog-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    background: transparent;
    color: var(--color-fg-muted);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .dialog-close:hover {
    background-color: var(--color-bg-subtle);
    color: var(--color-fg);
  }

  .dialog-content {
    padding: 1.5rem;
  }

  .section {
    margin-bottom: 1.5rem;
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .section-label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-fg);
  }

  .target-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .target-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem;
    border: 2px solid var(--color-border);
    background: transparent;
    border-radius: 0.75rem;
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
  }

  .target-btn:hover {
    border-color: var(--color-primary);
    background-color: var(--color-primary-subtle);
  }

  .target-btn.selected {
    border-color: var(--color-primary);
    background-color: var(--color-primary-subtle);
  }

  .target-icon {
    font-size: 1.5rem;
  }

  .target-name {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-fg);
  }

  .command-box {
    margin-bottom: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .command-box:last-child {
    margin-bottom: 0;
  }

  .command-label {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-fg-muted);
    background-color: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
  }

  .command-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }

  .command-content code {
    flex: 1;
    font-size: 0.75rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-fg);
    overflow-x: auto;
    white-space: nowrap;
  }

  .error-text {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: var(--color-error);
  }

  .github-section {
    text-align: center;
    padding-top: 1rem;
    border-top: 1px solid var(--color-border);
  }

  .github-text {
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    color: var(--color-fg-muted);
  }

  .github-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-fg);
    background-color: var(--color-bg-subtle);
    border-radius: 0.5rem;
    text-decoration: none;
    transition: background-color 0.15s;
  }

  .github-link:hover {
    background-color: var(--color-bg-muted);
  }
</style>
