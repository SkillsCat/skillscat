<script lang="ts">
  /**
   * ConfirmDialog - Reusable confirmation dialog component
   */
  import { Button } from '$lib/components';

  interface Props {
    open: boolean;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    danger?: boolean;
    loading?: boolean;
  }

  let {
    open,
    title,
    description,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    danger = true,
    loading = false,
  }: Props = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dialog-overlay" role="presentation" onclick={onCancel}>
    <div
      class="dialog"
      class:danger-dialog={danger}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id="confirm-dialog-title" class:danger-title={danger}>{title}</h2>
      <p class="dialog-description">{description}</p>
      <div class="dialog-actions">
        <Button variant="ghost" onclick={onCancel} disabled={loading}>
          {cancelText}
        </Button>
        <Button variant={danger ? 'danger' : 'cute'} onclick={onConfirm} disabled={loading}>
          {loading ? 'Processing...' : confirmText}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .dialog {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    width: 100%;
    max-width: 400px;
  }

  .danger-dialog {
    border-color: rgba(239, 68, 68, 0.3);
  }

  .dialog h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    color: var(--foreground);
  }

  .danger-title {
    color: #ef4444;
  }

  .dialog-description {
    font-size: 0.9375rem;
    color: var(--muted-foreground);
    margin-bottom: 1.5rem;
    line-height: 1.5;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }
</style>
