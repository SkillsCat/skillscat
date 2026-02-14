<script lang="ts">
  /**
   * SubmitDialog - 提交 Skill 对话框组件
   * 使用 Bits UI Dialog 组件实现
  */
  import { Dialog } from 'bits-ui';
  import { fade, fly } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { buildSkillPath } from '$lib/skill-path';

  interface Props {
    isOpen?: boolean;
    onClose?: () => void;
  }

  interface SubmitResult {
    path: string;
    status: 'queued' | 'exists' | 'failed';
    slug?: string;
  }

  let { isOpen = false, onClose }: Props = $props();

  // Form state
  let githubUrl = $state('');
  let isSubmitting = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);
  let existingSkillSlug = $state<string | null>(null);

  // Result state for multi-skill submission
  let submitResults = $state<SubmitResult[]>([]);
  let submittedCount = $state(0);
  let existingCount = $state(0);

  // Validate GitHub URL
  const isValidUrl = $derived(() => {
    if (!githubUrl) return false;
    const pattern = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\/tree\/[\w.-]+)?(?:\/[\w.-/]+)?$/;
    return pattern.test(githubUrl);
  });

  async function handleSubmit() {
    if (!isValidUrl) return;

    isSubmitting = true;
    error = null;
    success = false;
    existingSkillSlug = null;
    submitResults = [];
    submittedCount = 0;
    existingCount = 0;

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: githubUrl }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        existingSlug?: string;
        submitted?: number;
        existing?: number;
        results?: SubmitResult[];
        message?: string;
      };

      if (!response.ok) {
        if (data.existingSlug) {
          existingSkillSlug = data.existingSlug;
          error = 'This skill already exists in our database.';
        } else {
          throw new Error(data.error || 'Failed to submit skill');
        }
        return;
      }

      // Handle results
      if (data.results && data.results.length > 0) {
        submitResults = data.results;
        submittedCount = data.submitted || 0;
        existingCount = data.existing || 0;
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
      submitResults = [];
      submittedCount = 0;
      existingCount = 0;
      onClose?.();
    }
  }

  function handleDone() {
    githubUrl = '';
    error = null;
    success = false;
    existingSkillSlug = null;
    submitResults = [];
    submittedCount = 0;
    existingCount = 0;
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
                  <div class="success-icon-wrapper">
                    <span class="success-icon">🎉</span>
                  </div>
                  <h3 class="success-title">
                    {#if submittedCount > 1}
                      {submittedCount} Skills Submitted!
                    {:else}
                      Skill Submitted!
                    {/if}
                  </h3>
                  <Dialog.Description class="success-text">
                    {#if submittedCount > 1}
                      Your skills have been submitted for review. They will appear in our catalog once processed.
                    {:else}
                      Your skill has been submitted for review. It will appear in our catalog once processed.
                    {/if}
                  </Dialog.Description>

                  {#if submitResults.length > 1}
                    <div class="results-summary">
                      {#if existingCount > 0}
                        <p class="results-note">{existingCount} skill{existingCount !== 1 ? 's' : ''} already existed</p>
                      {/if}
                    </div>
                  {/if}

                  <div class="success-action">
                    <Button variant="cute" onclick={handleDone}>
                      Done
                    </Button>
                  </div>
                </div>
              {:else}
                <Dialog.Description class="dialog-description">
                  Share an AI agent skill with the community. Enter the GitHub URL of a repository containing SKILL.md file(s).
                </Dialog.Description>

                <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                  <div class="form-group">
                    <label for="github-url" class="form-label">GitHub URL</label>
                    <Input
                      id="github-url"
                      type="url"
                      placeholder="https://github.com/owner/repo"
                      bind:value={githubUrl}
                      disabled={isSubmitting}
                      variant="cute"
                    />
                    <p class="form-hint">
                      All SKILL.md files in the repository will be automatically submitted
                    </p>
                  </div>

                  {#if error}
                    <div class="error-message">
                      <p>{error}</p>
                      {#if existingSkillSlug}
                        <a href={buildSkillPath(existingSkillSlug)} class="error-link">
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
                      variant="cute"
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
                        Submit
                      {/if}
                    </Button>
                  </div>
                </form>

                <div class="guidelines">
                  <h4 class="guidelines-title">Submission Guidelines</h4>
                  <ul class="guidelines-list">
                    <li><span class="guidelines-icon">📦</span> The repository must be public</li>
                    <li><span class="guidelines-icon">📄</span> Must contain valid SKILL.md file(s)</li>
                    <li><span class="guidelines-icon">🎯</span> Skills should be useful for AI agent users</li>
                    <li><span class="guidelines-icon">🛡️</span> No malicious or harmful content</li>
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
    padding: 1rem;
    background-color: var(--bg-muted);
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .guidelines-title {
    margin: 0 0 0.75rem 0;
    font-size: 0.8125rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
  }

  .guidelines-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .guidelines-list li {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-size: 0.875rem;
    color: var(--foreground);
    line-height: 1.4;
  }

  .guidelines-icon {
    flex-shrink: 0;
    font-size: 1rem;
  }

  .success-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 2rem 1rem;
  }

  .success-icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 5rem;
    height: 5rem;
    background: var(--primary-subtle);
    border: 3px solid var(--primary);
    border-radius: var(--radius-full);
    margin-bottom: 1.5rem;
  }

  .success-icon {
    font-size: 2.5rem;
    line-height: 1;
  }

  .success-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--foreground);
    margin: 0 0 0.75rem 0;
  }

  :global(.success-text) {
    color: var(--muted-foreground);
    line-height: 1.6;
    margin: 0;
    max-width: 280px;
  }

  .results-summary {
    margin-top: 1rem;
  }

  .results-note {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin: 0;
  }

  .success-action {
    margin-top: 2rem;
  }
</style>
