<script lang="ts">
  interface Props {
    size?: 'sm' | 'md' | 'lg';
    showText?: boolean;
  }

  let { size = 'md', showText = true }: Props = $props();

  const sizes = {
    sm: { icon: 'text-xl', text: 'text-lg' },
    md: { icon: 'text-2xl', text: 'text-xl' },
    lg: { icon: 'text-3xl', text: 'text-2xl' }
  };
</script>

<a href="/" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
  <span class={sizes[size].icon}>🐱</span>
  {#if showText}
    <span class="{sizes[size].text} font-semibold text-fg">SkillsCat</span>
  {/if}
</a>
