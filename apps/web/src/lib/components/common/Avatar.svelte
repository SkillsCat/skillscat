<script lang="ts">
  import { resolvePublicAvatarSources } from '$lib/avatar';

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
    /** Image loading strategy (default: "lazy") */
    loading?: "lazy" | "eager";
    /** Image fetch priority hint (default: "auto") */
    fetchpriority?: "high" | "auto";
    /** Whether to use GitHub avatar as fallback when src is null (default: false) */
    useGithubFallback?: boolean;
  }

  let {
    src = null,
    alt = "",
    fallback = null,
    size = "md",
    shape = "squircle",
    border = false,
    shadow = false,
    class: className = "",
    loading = "lazy",
    fetchpriority = "auto",
    useGithubFallback = false,
  }: Props = $props();

  let imageError = $state(false);

  const sizeMap: Record<Size, number> = {
    xs: 24,
    sm: 32,
    md: 48,
    lg: 80,
    xl: 120,
  };

  const avatarSize = $derived(sizeMap[size]);

  const imageSources = $derived(
    resolvePublicAvatarSources({
      src,
      fallback,
      useGithubFallback,
      displaySize: avatarSize,
    }),
  );

  const placeholder = $derived(
    alt ? alt[0].toUpperCase() : fallback?.[0]?.toUpperCase() || "?",
  );

  // Retry when a prop change resolves to a different image variant.
  $effect(() => {
    imageSources.src;
    imageSources.srcset;
    imageError = false;
  });
</script>

<div
  class="avatar-container {shape} size-{size} {className}"
  class:border
  class:shadow
  style="--avatar-size: {avatarSize}px; width: {avatarSize}px; height: {avatarSize}px;"
>
  {#if imageSources.src && !imageError}
    <img
      src={imageSources.src}
      srcset={imageSources.srcset}
      {alt}
      {loading}
      {fetchpriority}
      decoding="async"
      width={avatarSize}
      height={avatarSize}
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
