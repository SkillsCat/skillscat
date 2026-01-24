<script lang="ts">
  /**
   * LoginDialog - 登录对话框组件
   * 使用 Bits UI Dialog 组件实现
   */
  import { Dialog } from 'bits-ui';
  import { signIn } from '$lib/auth-client';
  import { fade, fly } from 'svelte/transition';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { Cancel01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    isOpen?: boolean;
    onClose?: () => void;
  }

  let { isOpen = false, onClose }: Props = $props();

  function handleSignIn() {
    signIn.social({
      provider: 'github',
      callbackURL: '/'
    });
    onClose?.();
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      onClose?.();
    }
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
              <Dialog.Title class="dialog-title">Sign In</Dialog.Title>
              <Dialog.Close class="dialog-close" aria-label="Close">
                <HugeiconsIcon icon={Cancel01Icon} size={20} strokeWidth={2} />
              </Dialog.Close>
            </div>

            <div class="dialog-content">
              <Dialog.Description class="dialog-description">
                Sign in to save your favorite skills and submit new ones to the community.
              </Dialog.Description>

              <div class="login-buttons">
                <button
                  type="button"
                  onclick={() => handleSignIn()}
                  class="login-button login-button-github"
                >
                  <!-- GitHub logo - keep as custom SVG for brand accuracy -->
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  <span>Continue with GitHub</span>
                </button>
              </div>

              <p class="dialog-footer-text">
                By signing in, you agree to our Terms of Service and Privacy Policy.
              </p>
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
    background-color: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 51;
    width: calc(100% - 2rem);
    max-width: 24rem;
    background-color: var(--card);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-xl);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 2px solid var(--border);
  }

  :global(.dialog-title) {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--foreground);
    margin: 0;
  }

  :global(.dialog-close) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 2px solid var(--border);
    background: var(--card);
    color: var(--muted-foreground);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  :global(.dialog-close:hover) {
    border-color: var(--primary);
    background-color: var(--primary-subtle);
    color: var(--primary);
    transform: rotate(90deg);
  }

  .dialog-content {
    padding: 1.5rem;
  }

  :global(.dialog-description) {
    margin: 0 0 1.5rem 0;
    color: var(--muted-foreground);
    font-size: 0.9375rem;
    line-height: 1.6;
    text-align: center;
  }

  .login-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .login-button {
    --btn-shadow-offset: 4px;

    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.875rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: var(--radius-full);
    cursor: pointer;
    border: none;
    transform: translateY(0);
    transition: transform 0.1s ease, box-shadow 0.1s ease, background-color 0.15s ease;
  }

  .login-button:hover {
    --btn-shadow-offset: 6px;
    transform: translateY(-2px);
  }

  .login-button:active {
    --btn-shadow-offset: 1px;
    transform: translateY(3px);
  }

  .login-button-github {
    --btn-shadow-color: #0d1117;
    background-color: #24292e;
    color: white;
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
  }

  .login-button-github:hover {
    background-color: #2d333b;
  }

  .dialog-footer-text {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--border);
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    text-align: center;
    line-height: 1.6;
  }
</style>
