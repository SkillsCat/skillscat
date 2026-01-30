<script lang="ts">
  import { Button } from '$lib/components';
  import type { Snippet } from 'svelte';

  interface Props {
    /** HTTP 状态码，如 404, 500 等 */
    code?: number | string;
    /** 错误标题 */
    title?: string;
    /** 错误描述信息 */
    message?: string;
    /** 自定义图标 snippet */
    icon?: Snippet;
    /** 是否全页面展示（居中占满视口） */
    fullPage?: boolean;
    /** 主要操作按钮文字 */
    primaryActionText?: string;
    /** 主要操作按钮链接 */
    primaryActionHref?: string;
    /** 主要操作按钮点击事件 */
    primaryActionClick?: () => void;
    /** 次要操作按钮文字 */
    secondaryActionText?: string;
    /** 次要操作按钮链接 */
    secondaryActionHref?: string;
    /** 次要操作按钮点击事件 */
    secondaryActionClick?: () => void;
  }

  let {
    code,
    title = 'Something went wrong',
    message,
    icon,
    fullPage = false,
    primaryActionText,
    primaryActionHref,
    primaryActionClick,
    secondaryActionText,
    secondaryActionHref,
    secondaryActionClick,
  }: Props = $props();

  const hasActions = $derived(primaryActionText || secondaryActionText);
</script>

<div class="error-state" class:full-page={fullPage}>
  <div class="error-content">
    <!-- Icon -->
    <div class="error-icon">
      {#if icon}
        {@render icon()}
      {:else}
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      {/if}
    </div>

    <!-- Error Code -->
    {#if code}
      <h1 class="error-code">{code}</h1>
    {/if}

    <!-- Title -->
    <h2 class="error-title">{title}</h2>

    <!-- Message -->
    {#if message}
      <p class="error-message">{message}</p>
    {/if}

    <!-- Actions -->
    {#if hasActions}
      <div class="error-actions">
        {#if primaryActionText}
          <Button
            variant="cute"
            href={primaryActionHref}
            onclick={primaryActionClick}
          >
            {primaryActionText}
          </Button>
        {/if}

        {#if secondaryActionText}
          <Button
            variant="cute-secondary"
            href={secondaryActionHref}
            onclick={secondaryActionClick}
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {secondaryActionText}
          </Button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .error-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem 1.5rem;
  }

  .error-state.full-page {
    min-height: calc(100vh - 12rem);
  }

  .error-content {
    text-align: center;
    max-width: 28rem;
  }

  .error-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 5rem;
    height: 5rem;
    margin: 0 auto 1.5rem;
    background: linear-gradient(135deg, var(--primary-subtle) 0%, rgba(var(--accent-rgb, 255, 140, 0), 0.1) 100%);
    border: 2px solid var(--primary);
    border-radius: var(--radius-xl);
    color: var(--primary);
  }

  .error-icon :global(svg) {
    width: 2.5rem;
    height: 2.5rem;
  }

  .error-code {
    font-size: clamp(4rem, 10vw, 7rem);
    font-weight: 900;
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    margin-bottom: 0.5rem;
  }

  .error-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--fg);
    margin-bottom: 0.75rem;
  }

  .error-message {
    font-size: 0.9375rem;
    color: var(--fg-muted);
    margin-bottom: 2rem;
    line-height: 1.6;
  }

  .error-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
    align-items: center;
  }
</style>
