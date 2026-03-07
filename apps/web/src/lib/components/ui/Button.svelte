<script lang="ts">
  /**
   * Button - 可爱风格按钮组件
   * 支持 href 时自动渲染为 a 标签，也可指定为 div 渲染
   */
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  interface Props extends HTMLAttributes<HTMLElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'cute' | 'cute-secondary' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    renderAs?: 'button' | 'div';
    href?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    renderAs = 'button',
    href,
    children,
    class: className = '',
    disabled = false,
    type = 'button',
    onclick,
    ...restProps
  }: Props = $props();

  const variantClasses: Record<string, string> = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    outline: 'btn-outline',
    cute: 'btn-cute',
    'cute-secondary': 'btn-cute-secondary',
    danger: 'btn-danger'
  };

  const sizeClasses: Record<string, string> = {
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg'
  };

  const classes = $derived(`btn ${variantClasses[variant]} ${sizeClasses[size]} ${className}`);
</script>

{#if href}
  <a {...restProps} {href} {onclick} class={classes} class:opacity-50={disabled} class:pointer-events-none={disabled}>
    <span class="btn-content">
      {@render children()}
    </span>
  </a>
{:else if renderAs === 'div'}
  <div
    {...restProps}
    onclick={disabled ? undefined : onclick}
    tabindex={disabled ? undefined : restProps.tabindex}
    aria-disabled={disabled ? 'true' : undefined}
    role="button"
    class={classes}
    class:opacity-50={disabled}
    class:pointer-events-none={disabled}
  >
    <span class="btn-content">
      {@render children()}
    </span>
  </div>
{:else}
  <button {...restProps} {type} {disabled} {onclick} class={classes}>
    <span class="btn-content">
      {@render children()}
    </span>
  </button>
{/if}

<style>
  .btn-content {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
