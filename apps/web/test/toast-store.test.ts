import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

async function loadToastStore() {
  vi.resetModules();
  return await import('../src/lib/components/ui/toast-store.ts');
}

describe('toast store host timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('does not start dismissal before a toast host is mounted', async () => {
    const toastStore = await loadToastStore();

    toastStore.toast('hello', 'error', 1000);
    expect(get(toastStore.toasts)).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    expect(get(toastStore.toasts)).toHaveLength(1);

    const unregister = toastStore.registerToastHost();
    vi.advanceTimersByTime(999);
    expect(get(toastStore.toasts)).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(get(toastStore.toasts)).toHaveLength(0);

    unregister();
  });

  it('starts dismissal immediately when a host is already mounted', async () => {
    const toastStore = await loadToastStore();
    const unregister = toastStore.registerToastHost();

    toastStore.toast('hello', 'success', 1200);
    expect(get(toastStore.toasts)).toHaveLength(1);

    vi.advanceTimersByTime(1199);
    expect(get(toastStore.toasts)).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(get(toastStore.toasts)).toHaveLength(0);

    unregister();
  });
});
