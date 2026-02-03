declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
  export const toast: (message: string, type?: 'success' | 'error' | 'info') => void;
  export const dismissToast: () => void;
}
