declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;

  interface ToastOptions {
    duration?: number;
    celebrate?: boolean;
  }

  export const toast: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning',
    config?: number | ToastOptions
  ) => string;
  export const dismissToast: (id: string) => void;
}
