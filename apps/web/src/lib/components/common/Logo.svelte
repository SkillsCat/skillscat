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
  <!-- Squircle clip path for logo -->
  <svg width="0" height="0" class="absolute">
    <clipPath id="logo-squircle" clipPathUnits="objectBoundingBox">
      <path d="M 0,0.5 C 0,0 0,0 0.5,0 S 1,0 1,0.5 1,1 0.5,1 0,1 0,0.5" />
    </clipPath>
  </svg>
  <div class="logo-wrapper">
    <img
      src="/favicon-64x64.png"
      alt="SkillsCat"
      width={sizes[size].icon}
      height={sizes[size].icon}
      class="logo-icon"
    />
  </div>
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

  .logo-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.6);
    border-radius: 0.5rem;
  }

  :global(.dark) .logo-wrapper {
    background: rgba(255, 255, 255, 0.15);
  }

  .logo-icon {
    flex-shrink: 0;
    display: block;
    clip-path: url(#logo-squircle);
    border-radius: 22%; /* Fallback for unsupported browsers */
  }

  .logo-text {
    font-weight: 600;
    color: var(--foreground);
  }
</style>
