<script lang="ts">
  interface Props {
    size?: 'sm' | 'md' | 'lg';
    showText?: boolean;
  }

  let { size = 'md', showText = true }: Props = $props();

  const sizes = {
    sm: { icon: 20, text: 'text-lg' },
    md: { icon: 28, text: 'text-xl' },
    lg: { icon: 36, text: 'text-2xl' }
  };
</script>

<a href="/" class="logo-link">
  <img
    src="/favicon-64x64.png"
    alt="SkillsCat"
    width={sizes[size].icon}
    height={sizes[size].icon}
    class="logo-icon"
  />
  {#if showText}
    <span class="logo-text {sizes[size].text}">SkillsCat</span>
  {/if}
</a>

<style>
  .logo-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    transition: opacity 0.15s ease;
  }

  .logo-link:hover {
    opacity: 0.8;
  }

  .logo-icon {
    flex-shrink: 0;
    filter: drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.15));
    transition: filter 0.15s ease, transform 0.15s ease;
  }

  :global(.dark) .logo-icon {
    filter: brightness(0.85) drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.3));
  }

  .logo-link:hover .logo-icon {
    transform: scale(1.05) rotate(-3deg);
  }

  .logo-text {
    font-weight: 600;
    color: var(--foreground);
  }
</style>
