<script lang="ts">
  type Size = "xs" | "sm" | "md" | "lg" | "xl";
  type Shape = "circle" | "squircle";

  interface Props {
    src?: string | null;
    alt?: string;
    fallback?: string | null;
    size?: Size;
    shape?: Shape;
    border?: boolean;
    shadow?: boolean;
    class?: string;
    /** Whether to use GitHub avatar as fallback when src is null (default: false) */
    useGithubFallback?: boolean;
  }

  let {
    src = null,
    alt = "",
    fallback = null,
    size = "md",
    shape = "squircle",
    border = true,
    shadow = false,
    class: className = "",
    useGithubFallback = false,
  }: Props = $props();

  let imageError = $state(false);

  const sizeMap: Record<Size, { px: number; github: number }> = {
    xs: { px: 24, github: 48 },
    sm: { px: 32, github: 64 },
    md: { px: 48, github: 96 },
    lg: { px: 80, github: 160 },
    xl: { px: 120, github: 240 },
  };

  const imageUrl = $derived(
    src ||
      (useGithubFallback && fallback
        ? `https://avatars.githubusercontent.com/${fallback}?s=${sizeMap[size].github}`
        : null),
  );

  const placeholder = $derived(
    alt ? alt[0].toUpperCase() : fallback?.[0]?.toUpperCase() || "?",
  );

  // Reset error state when src changes
  $effect(() => {
    src;
    imageError = false;
  });
</script>

<div
  class="avatar-container {shape} size-{size} {className}"
  class:border
  class:shadow
  style="--avatar-size: {sizeMap[size].px}px"
>
  {#if imageUrl && !imageError}
    <img
      src={imageUrl}
      {alt}
      loading="lazy"
      class="avatar-image"
      onerror={() => {
        imageError = true;
      }}
    />
  {:else}
    <div class="avatar-placeholder">{placeholder}</div>
  {/if}
</div>

<style>
  .avatar-container {
    width: var(--avatar-size);
    height: var(--avatar-size);
    border-radius: 16%;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--muted);
  }

  .avatar-container.circle {
    border-radius: 50%;
  }

  .avatar-container.border {
    border: 2px solid color-mix(in oklch, var(--fg) 12%, transparent);
  }

  :global(.dark) .avatar-container.border {
    border-color: color-mix(in oklch, var(--fg) 8%, transparent);
  }

  .avatar-container.size-xl.border {
    border-width: 3px;
  }

  .avatar-container.shadow {
    box-shadow: 4px 4px 0 0 var(--border-sketch);
  }

  .avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--primary), var(--primary-hover));
    color: white;
    font-weight: 700;
    font-size: calc(var(--avatar-size) * 0.4);
  }
</style>
