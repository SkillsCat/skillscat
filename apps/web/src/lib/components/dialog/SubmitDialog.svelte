<script lang="ts">
  /**
   * SubmitDialog - 提交 Skill 对话框组件
   * 使用 Bits UI Dialog 组件实现
   */
  import { Dialog } from 'bits-ui';
  import { fade, fly } from 'svelte/transition';
  import { Button, Input } from '$lib/components';

  interface Props {
    isOpen?: boolean;
    onClose?: () => void;
  }

  let { isOpen = false, onClose }: Props = $props();

  let githubUrl = $state('');
  let isSubmitting = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);
  let existingSkillSlug = $state<string | null>(null);

  // Validate GitHub URL
  const isValidUrl = $derived(() => {
    if (!githubUrl) return false;
    const pattern = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\/tree\/[\w.-]+)?(?:\/[\w.-/]+)?$/;
    return pattern.test(githubUrl);
  });

  // Extract repo info from URL
  function parseGitHubUrl(url: string): { owner: string; repo: string; path: string } | null {
    const match = url.match(/github\.com\/([\w-]+)\/([\w.-]+)(?:\/tree\/[\w.-]+)?(\/.*)?$/);
    if (!match) return null;
    return {
      owner: match[1],
      repo: match[2],
      path: match[3]?.slice(1) || '',
    };
  }

  async function handleSubmit() {
    if (!isValidUrl) return;

    isSubmitting = true;
    error = null;
    success = false;
    existingSkillSlug = null;

    try {
      const repoInfo = parseGitHubUrl(githubUrl);
      if (!repoInfo) {
        throw new Error('Invalid GitHub URL');
      }

      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: githubUrl,
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          path: repoInfo.path,
        }),
      });

      const data = await response.json() as { error?: string; existingSlug?: string };

      if (!response.ok) {
        if (data.existingSlug) {
          existingSkillSlug = data.existingSlug;
          error = 'This skill already exists in our database.';
        } else {
          throw new Error(data.error || 'Failed to submit skill');
        }
        return;
      }

      success = true;
      githubUrl = '';
    } catch (err: any) {
      error = err.message || 'An error occurred';
    } finally {
      isSubmitting = false;
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      githubUrl = '';
      error = null;
      success = false;
      existingSkillSlug = null;
      onClose?.();
    }
  }

  function handleDone() {
    onClose?.();
  }
</script>

<Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} class="dialog-overlay" transition:fade={{ duration: 150 }}></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>

    <Dialog.Content forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} class="dialog" transition:fly={{ y: 10, duration: 200 }}>
            <div class="dialog-header">
              <Dialog.Title class="dialog-title">Submit a Skill</Dialog.Title>
              <Dialog.Close class="dialog-close" aria-label="Close">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Dialog.Close>
            </div>

            <div class="dialog-content">
              {#if success}
                <div class="success-message">
                  <div class="success-icon">🎉</div>
                  <h3 class="success-title">Skill Submitted!</h3>
                  <Dialog.Description class="success-text">
                    Your skill has been submitted for review. It will appear in our catalog once processed.
                  </Dialog.Description>
                  <Button variant="primary" onclick={handleDone}>
                    Done
                  </Button>
                </div>
              {:else}
                <Dialog.Description class="dialog-description">
                  Share a Claude Code skill with the community. Enter the GitHub URL of a folder containing a SKILL.md file.
                </Dialog.Description>

                <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                  <div class="form-group">
                    <label for="github-url" class="form-label">GitHub URL</label>
                    <Input
                      id="github-url"
                      type="url"
                      placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
                      bind:value={githubUrl}
                      disabled={isSubmitting}
                    />
                    <p class="form-hint">
                      The folder must contain a SKILL.md file
                    </p>
                  </div>

                  {#if error}
                    <div class="error-message">
                      <p>{error}</p>
                      {#if existingSkillSlug}
                        <a href="/skills/{existingSkillSlug}" class="error-link">
                          View existing skill →
                        </a>
                      {/if}
                    </div>
                  {/if}

                  <div class="form-actions">
                    <Dialog.Close>
                      <Button variant="secondary" type="button">
                        Cancel
                      </Button>
                    </Dialog.Close>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={!isValidUrl || isSubmitting}
                    >
                      {#if isSubmitting}
                        <svg class="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Submitting...
                      {:else}
                        Submit Skill
                      {/if}
                    </Button>
                  </div>
                </form>

                <div class="guidelines">
                  <h4 class="guidelines-title">Submission Guidelines</h4>
                  <ul class="guidelines-list">
                    <li>The repository must be public</li>
                    <li>The folder must contain a valid SKILL.md file</li>
                    <li>Skills should be useful for Claude Code users</li>
                    <li>No malicious or harmful content</li>
                  </ul>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 51;
    width: calc(100% - 2rem);
    max-width: 32rem;
    max-height: 90vh;
    overflow-y: auto;
    background-color: var(--background);
    border-radius: 1rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .dialog-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .dialog-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    background: transparent;
    color: var(--muted-foreground);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .dialog-close:hover {
    background-color: var(--card);
    color: var(--foreground);
  }

  .dialog-content {
    padding: 1.5rem;
  }

  .dialog-description {
    margin-bottom: 1.5rem;
    color: var(--muted-foreground);
    line-height: 1.6;
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  .form-label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
  }

  .form-hint {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }

  .error-message {
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    color: #ef4444;
    font-size: 0.875rem;
  }

  .error-link {
    display: inline-block;
    margin-top: 0.5rem;
    color: var(--primary);
    text-decoration: none;
  }

  .error-link:hover {
    text-decoration: underline;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .guidelines {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .guidelines-title {
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .guidelines-list {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
    line-height: 1.8;
  }

  .success-message {
    text-align: center;
    padding: 1rem 0;
  }

  .success-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .success-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--foreground);
    margin-bottom: 0.5rem;
  }

  .success-text {
    color: var(--muted-foreground);
    margin-bottom: 1.5rem;
    line-height: 1.6;
  }
</style>
