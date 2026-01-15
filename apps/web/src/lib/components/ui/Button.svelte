<script lang="ts">
  /**
   * Button - 按钮组件
   * 支持 href 时自动渲染为 a 标签
   */
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
    size?: 'sm' | 'md' | 'lg';
    href?: string;
    children: Snippet;
    class?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    onclick?: (e: MouseEvent) => void;
  }

  let {
    variant = 'primary',
    size = 'md',
    href,
    children,
    class: className = '',
    disabled = false,
    type = 'button',
    onclick,
  }: Props = $props();

  const variantClasses: Record<string, string> = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    outline: 'bg-transparent border-2 border-primary text-primary hover:bg-primary-subtle'
  };

  const sizeClasses: Record<string, string> = {
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg'
  };

  const classes = $derived(`btn ${variantClasses[variant]} ${sizeClasses[size]} ${className}`);
</script>

{#if href}
  <a {href} class={classes} class:opacity-50={disabled} class:pointer-events-none={disabled}>
    {@render children()}
  </a>
{:else}
  <button {type} {disabled} {onclick} class={classes}>
    {@render children()}
  </button>
{/if}
