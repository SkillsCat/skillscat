<script lang="ts" module>
  import { writable } from 'svelte/store';

  export interface ToastData {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
    duration?: number;
  }

  const toasts = writable<ToastData[]>([]);

  let toastId = 0;

  export function toast(message: string, type: ToastData['type'] = 'success', duration = 3000) {
    const id = `toast-${++toastId}`;
    toasts.update(t => [...t, { id, type, message, duration }]);

    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }

    return id;
  }

  export function dismissToast(id: string) {
    toasts.update(t => t.filter(toast => toast.id !== id));
  }

  export { toasts };
</script>

<script lang="ts">
  import { fly, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';

  const iconMap = {
    success: {
      icon: '✓',
      emoji: '🎉',
      bgClass: 'toast-success'
    },
    error: {
      icon: '✕',
      emoji: '😿',
      bgClass: 'toast-error'
    },
    info: {
      icon: 'i',
      emoji: '💡',
      bgClass: 'toast-info'
    },
    warning: {
      icon: '!',
      emoji: '⚠️',
      bgClass: 'toast-warning'
    }
  };
</script>

<div class="toast-container" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div
      class="toast {iconMap[t.type].bgClass}"
      in:fly={{ y: -20, duration: 400, easing: backOut }}
      out:scale={{ duration: 200, start: 0.95 }}
    >
      <div class="toast-icon">
        <span class="toast-emoji">{iconMap[t.type].emoji}</span>
        <span class="toast-check">{iconMap[t.type].icon}</span>
      </div>
      <p class="toast-message">{t.message}</p>
      <button
        class="toast-close"
        onclick={() => dismissToast(t.id)}
        aria-label="Dismiss"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    pointer-events: none;
  }

  .toast {
    --toast-shadow-color: oklch(50% 0.15 145);

    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    min-width: 280px;
    max-width: 400px;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow:
      0 4px 0 0 var(--toast-shadow-color),
      0 8px 20px -4px rgba(0, 0, 0, 0.1);
    pointer-events: auto;
    transform: translateY(0);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .toast:hover {
    transform: translateY(-2px);
    box-shadow:
      0 6px 0 0 var(--toast-shadow-color),
      0 12px 24px -4px rgba(0, 0, 0, 0.12);
  }

  .toast-success {
    --toast-shadow-color: oklch(55% 0.15 145);
    border-color: oklch(75% 0.12 145);
  }

  .toast-error {
    --toast-shadow-color: oklch(50% 0.15 25);
    border-color: oklch(70% 0.12 25);
  }

  .toast-info {
    --toast-shadow-color: oklch(55% 0.12 240);
    border-color: oklch(75% 0.10 240);
  }

  .toast-warning {
    --toast-shadow-color: oklch(60% 0.15 85);
    border-color: oklch(80% 0.12 85);
  }

  .toast-icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
  }

  .toast-emoji {
    font-size: 1.5rem;
    line-height: 1;
    animation: bounce 0.6s ease-out;
  }

  .toast-check {
    position: absolute;
    bottom: -2px;
    right: -2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.125rem;
    height: 1.125rem;
    font-size: 0.625rem;
    font-weight: 700;
    color: white;
    background: var(--success);
    border-radius: 50%;
    border: 2px solid var(--card);
    animation: pop 0.3s ease-out 0.2s both;
  }

  .toast-error .toast-check {
    background: var(--error);
  }

  .toast-info .toast-check {
    background: var(--info);
  }

  .toast-warning .toast-check {
    background: var(--warning);
  }

  .toast-message {
    flex: 1;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--fg);
    line-height: 1.4;
    margin: 0;
  }

  .toast-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    color: var(--fg-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .toast-close:hover {
    color: var(--fg);
    background: var(--bg-muted);
  }

  @keyframes bounce {
    0% {
      transform: scale(0) rotate(-10deg);
    }
    50% {
      transform: scale(1.2) rotate(5deg);
    }
    70% {
      transform: scale(0.9) rotate(-3deg);
    }
    100% {
      transform: scale(1) rotate(0deg);
    }
  }

  @keyframes pop {
    0% {
      transform: scale(0);
    }
    70% {
      transform: scale(1.2);
    }
    100% {
      transform: scale(1);
    }
  }

  /* Mobile responsive */
  @media (max-width: 480px) {
    .toast-container {
      left: 1rem;
      right: 1rem;
    }

    .toast {
      min-width: auto;
      max-width: none;
    }
  }
</style>
