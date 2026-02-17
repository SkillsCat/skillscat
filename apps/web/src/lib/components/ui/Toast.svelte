<script lang="ts" module>
  import { writable } from 'svelte/store';

  export interface ToastData {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
    duration?: number;
    celebrate?: boolean;
  }

  export interface ToastOptions {
    duration?: number;
    celebrate?: boolean;
  }

  const toasts = writable<ToastData[]>([]);

  let toastId = 0;

  export function toast(
    message: string,
    type: ToastData['type'] = 'success',
    config: number | ToastOptions = 3000
  ) {
    const duration = typeof config === 'number' ? config : (config.duration ?? 3000);
    const celebrate = typeof config === 'number' ? false : Boolean(config.celebrate);
    const id = `toast-${++toastId}`;
    toasts.update(t => [...t, { id, type, message, duration, celebrate }]);

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
  import { fade } from 'svelte/transition';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Alert02Icon, Cancel01Icon, InformationCircleIcon, Tick02Icon } from '@hugeicons/core-free-icons';

  const MAX_STACK_DEPTH = 4;
  const STACK_Z_STEP = 120;
  const STACK_X_STEP = 6;
  const STACK_Y_STEP = 22;
  const STACK_ROTATE_X_STEP = 2.4;
  const STACK_ROTATE_Y_STEP = 1.2;
  const MIN_STACK_SCALE = 0.85;
  const STACK_SCALE_RATIO = Number(Math.pow(MIN_STACK_SCALE, 1 / MAX_STACK_DEPTH).toFixed(4));
  const MIN_STACK_OPACITY = 0.45;

  function getStackDepth(index: number, total: number): number {
    return Math.min(Math.max(total - 1 - index, 0), MAX_STACK_DEPTH);
  }

  function getUniformScale(depth: number): number {
    const scale = Math.pow(STACK_SCALE_RATIO, depth);
    return Math.max(MIN_STACK_SCALE, Number(scale.toFixed(3)));
  }

  function getStackVars(depth: number) {
    const z = -depth * STACK_Z_STEP;
    const x = depth * STACK_X_STEP;
    const y = depth * STACK_Y_STEP;
    const scale = getUniformScale(depth);
    const rotateX = Number((depth * STACK_ROTATE_X_STEP).toFixed(2));
    const rotateY = Number((depth * STACK_ROTATE_Y_STEP).toFixed(2));
    const opacity = Math.max(MIN_STACK_OPACITY, Number((1 - depth * 0.14).toFixed(3)));
    const desaturate = Number(Math.min(depth * 0.12, 0.45).toFixed(3));
    const brightness = Number(Math.max(0.7, 1 - depth * 0.06).toFixed(3));

    return { x, y, z, scale, rotateX, rotateY, opacity, desaturate, brightness };
  }

  const iconMap = {
    success: {
      icon: Tick02Icon,
      bgClass: 'toast-success'
    },
    error: {
      icon: Cancel01Icon,
      bgClass: 'toast-error'
    },
    info: {
      icon: InformationCircleIcon,
      bgClass: 'toast-info'
    },
    warning: {
      icon: Alert02Icon,
      bgClass: 'toast-warning'
    }
  };
</script>

<div class="toast-container" aria-live="polite">
  {#each $toasts as t, index (t.id)}
    {@const stackDepth = getStackDepth(index, $toasts.length)}
    {@const stack = getStackVars(stackDepth)}
    <div
      class="toast {iconMap[t.type].bgClass}"
      style={`--stack-x: ${stack.x}px; --stack-y: ${stack.y}px; --stack-z: ${stack.z}px; --stack-scale: ${stack.scale}; --stack-rotate-x: ${stack.rotateX}deg; --stack-rotate-y: ${stack.rotateY}deg; --stack-opacity: ${stack.opacity}; --stack-desaturate: ${stack.desaturate}; --stack-brightness: ${stack.brightness}; z-index: ${index + 1};`}
      in:fade={{ duration: 180 }}
      out:fade={{ duration: 140 }}
    >
      <div class="toast-icon">
        {#if t.celebrate && t.type === 'success'}
          <span class="toast-confetti toast-confetti-1"></span>
          <span class="toast-confetti toast-confetti-2"></span>
          <span class="toast-confetti toast-confetti-3"></span>
          <span class="toast-confetti toast-confetti-4"></span>
          <span class="toast-confetti toast-confetti-5"></span>
          <span class="toast-confetti toast-confetti-6"></span>
        {/if}
        <HugeiconsIcon icon={iconMap[t.type].icon} size={16} class="toast-icon-svg" />
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
    width: min(400px, calc(100vw - 2rem));
    height: 0;
    pointer-events: none;
    perspective: 900px;
    perspective-origin: top right;
    transform-style: preserve-3d;
  }

  .toast {
    --toast-shadow-color: oklch(50% 0.15 145);
    --stack-x: 0px;
    --stack-y: 0px;
    --stack-z: 0px;
    --stack-scale: 1;
    --stack-rotate-x: 0deg;
    --stack-rotate-y: 0deg;
    --stack-opacity: 1;
    --stack-desaturate: 0;
    --stack-brightness: 1;

    position: absolute;
    top: 0;
    right: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    min-width: 0;
    max-width: none;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow:
      0 4px 0 0 var(--toast-shadow-color),
      0 8px 20px -4px rgba(0, 0, 0, 0.1);
    pointer-events: auto;
    transform-origin: top right;
    transform:
      translate3d(var(--stack-x), var(--stack-y), var(--stack-z))
      rotateX(var(--stack-rotate-x))
      rotateY(var(--stack-rotate-y))
      scale(var(--stack-scale));
    opacity: var(--stack-opacity);
    filter: saturate(calc(1 - var(--stack-desaturate))) brightness(var(--stack-brightness));
    transform-style: preserve-3d;
    backface-visibility: hidden;
    transition:
      transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.22s ease,
      box-shadow 0.15s ease,
      filter 0.15s ease;
    will-change: transform, opacity;
  }

  .toast:hover {
    box-shadow:
      0 6px 0 0 var(--toast-shadow-color),
      0 12px 24px -4px rgba(0, 0, 0, 0.12);
    filter: none;
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
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    border: 1.5px solid transparent;
    flex-shrink: 0;
    overflow: visible;
    animation: pop 0.25s ease-out;
  }

  .toast-icon-svg {
    color: inherit;
    position: relative;
    z-index: 2;
  }

  .toast-confetti {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0.3rem;
    height: 0.12rem;
    border-radius: 999px;
    opacity: 0;
    pointer-events: none;
    z-index: 1;
    transform: translate(-50%, -50%) scale(0.2) rotate(0deg);
    animation: confetti-burst 0.7s ease-out forwards;
  }

  .toast-confetti-1 {
    --dx: -1.1rem;
    --dy: -1.1rem;
    --rot: -35deg;
    background: oklch(78% 0.19 145);
  }

  .toast-confetti-2 {
    --dx: 0;
    --dy: -1.25rem;
    --rot: 8deg;
    background: oklch(82% 0.16 85);
  }

  .toast-confetti-3 {
    --dx: 1.1rem;
    --dy: -1.05rem;
    --rot: 24deg;
    background: oklch(76% 0.2 205);
  }

  .toast-confetti-4 {
    --dx: -1rem;
    --dy: -0.2rem;
    --rot: -12deg;
    background: oklch(84% 0.13 25);
    animation-delay: 0.05s;
  }

  .toast-confetti-5 {
    --dx: 1.15rem;
    --dy: -0.25rem;
    --rot: 35deg;
    background: oklch(80% 0.18 330);
    animation-delay: 0.03s;
  }

  .toast-confetti-6 {
    --dx: 0;
    --dy: -1.45rem;
    --rot: 55deg;
    background: oklch(85% 0.14 260);
    animation-delay: 0.08s;
  }

  .toast-success .toast-icon {
    color: white;
    background: var(--success);
    border-color: oklch(60% 0.13 145);
  }

  .toast-error .toast-icon {
    color: white;
    background: var(--error);
    border-color: oklch(60% 0.13 25);
  }

  .toast-info .toast-icon {
    color: white;
    background: var(--info);
    border-color: oklch(62% 0.11 240);
  }

  .toast-warning .toast-icon {
    color: white;
    background: var(--warning);
    border-color: oklch(66% 0.12 85);
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

  @keyframes confetti-burst {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.2) rotate(0deg);
    }
    18% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1) rotate(var(--rot));
    }
  }

  /* Mobile responsive */
  @media (max-width: 480px) {
    .toast-container {
      left: 1rem;
      right: 1rem;
      width: auto;
    }
  }
</style>
