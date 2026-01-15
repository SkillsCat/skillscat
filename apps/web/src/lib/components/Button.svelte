<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
    size?: 'sm' | 'md' | 'lg';
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    children,
    class: className = '',
    ...restProps
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
</script>

<button
  class="btn {variantClasses[variant]} {sizeClasses[size]} {className}"
  {...restProps}
>
  {@render children()}
</button>
