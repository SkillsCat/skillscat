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

interface ToastTimerState {
  duration: number;
  started: boolean;
}

const toasts = writable<ToastData[]>([]);
const toastTimerState = new Map<string, ToastTimerState>();
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

let toastId = 0;
let mountedToastHosts = 0;

function clearDismissTimer(id: string): void {
  const timer = dismissTimers.get(id);
  if (!timer) return;

  clearTimeout(timer);
  dismissTimers.delete(id);
}

function startDismissTimer(id: string): void {
  const state = toastTimerState.get(id);
  if (!state || state.started || state.duration <= 0 || mountedToastHosts <= 0) {
    return;
  }

  state.started = true;
  dismissTimers.set(id, setTimeout(() => {
    dismissToast(id);
  }, state.duration));
}

export function registerToastHost(): () => void {
  mountedToastHosts += 1;

  for (const id of toastTimerState.keys()) {
    startDismissTimer(id);
  }

  return () => {
    mountedToastHosts = Math.max(0, mountedToastHosts - 1);
  };
}

export function toast(
  message: string,
  type: ToastData['type'] = 'success',
  config: number | ToastOptions = 3000
): string {
  const duration = typeof config === 'number' ? config : (config.duration ?? 3000);
  const celebrate = typeof config === 'number' ? false : Boolean(config.celebrate);
  const id = `toast-${++toastId}`;

  toastTimerState.set(id, {
    duration,
    started: false,
  });

  toasts.update((currentToasts) => [
    ...currentToasts,
    { id, type, message, duration, celebrate },
  ]);

  startDismissTimer(id);

  return id;
}

export function dismissToast(id: string): void {
  clearDismissTimer(id);
  toastTimerState.delete(id);
  toasts.update((currentToasts) => currentToasts.filter((toastItem) => toastItem.id !== id));
}

export { toasts };
