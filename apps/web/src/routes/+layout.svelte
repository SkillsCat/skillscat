<script lang="ts">
  import '../app.css';
  import { Navbar, Footer } from '$lib/components';
  import { onMount } from 'svelte';

  let { children } = $props();

  let scrollY = $state(0);
  let showNavbarMask = $derived(scrollY > 20);

  onMount(() => {
    const handleScroll = () => {
      scrollY = window.scrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  });
</script>

<div class="app-wrapper">
  <!-- Global Background Effect -->
  <div class="global-bg-deco">
    <div class="global-bg-blob global-bg-blob-1"></div>
    <div class="global-bg-blob global-bg-blob-2"></div>
    <div class="global-bg-blob global-bg-blob-3"></div>
  </div>

  <!-- Navbar gradient mask -->
  <div class="navbar-mask" class:navbar-mask-visible={showNavbarMask}></div>

  <div class="min-h-screen flex flex-col relative z-10">
    <Navbar />

    <main class="flex-1">
      {@render children()}
    </main>

    <Footer />
  </div>
</div>

<style>
  .app-wrapper {
    position: relative;
    min-height: 100vh;
  }

  .navbar-mask {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 5rem;
    background: linear-gradient(
      to bottom,
      var(--background) 0%,
      var(--background) 60%,
      transparent 100%
    );
    z-index: 40;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-default);
  }

  .navbar-mask-visible {
    opacity: 1;
  }

  .global-bg-deco {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }

  .global-bg-blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    opacity: 0.5;
  }

  :global(.dark) .global-bg-blob {
    filter: blur(100px);
    opacity: 0.35;
  }

  .global-bg-blob-1 {
    top: -15%;
    right: -10%;
    width: 500px;
    height: 500px;
    background: var(--primary-subtle);
    animation: blob-float 15s ease-in-out infinite;
  }

  .global-bg-blob-2 {
    bottom: -20%;
    left: -10%;
    width: 400px;
    height: 400px;
    background: var(--accent-subtle);
    animation: blob-float 18s ease-in-out infinite reverse;
    animation-delay: 2s;
  }

  .global-bg-blob-3 {
    top: 40%;
    right: 10%;
    width: 300px;
    height: 300px;
    background: var(--primary-subtle);
    animation: blob-float 20s ease-in-out infinite;
    animation-delay: 4s;
  }

  @keyframes blob-float {
    0%, 100% {
      transform: translate(0, 0) scale(1);
    }
    25% {
      transform: translate(30px, -30px) scale(1.05);
    }
    50% {
      transform: translate(-20px, 20px) scale(0.95);
    }
    75% {
      transform: translate(20px, 10px) scale(1.02);
    }
  }

  @media (max-width: 768px) {
    .global-bg-blob {
      opacity: 0.3;
    }

    :global(.dark) .global-bg-blob {
      opacity: 0.25;
    }
  }
</style>
