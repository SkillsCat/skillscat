<script lang="ts">
  import '../app.css';
  import Navbar from '$lib/components/layout/Navbar.svelte';
  import Footer from '$lib/components/layout/Footer.svelte';
  import Toast from '$lib/components/ui/Toast.svelte';
  import { onMount } from 'svelte';

  let { children, data } = $props();

  let scrollY = $state(0);
  let isScrolled = $derived(scrollY > 20);

  onMount(() => {
    let rafId = 0;
    const handleScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        scrollY = window.scrollY;
        rafId = 0;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // 注册 Service Worker (仅生产环境)
    const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isDev && 'serviceWorker' in navigator) {
      const registerServiceWorker = () => navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[SW] New version available');
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('[SW] Registration failed:', error);
        });

      if ('requestIdleCallback' in window) {
        (
          window as Window & {
            requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
          }
        ).requestIdleCallback(registerServiceWorker, { timeout: 2000 });
      } else {
        setTimeout(registerServiceWorker, 1200);
      }
    }

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  });
</script>

<div class="app-wrapper">
  <!-- Navbar Background - fades in when scrolled -->
  <div class="navbar-bg" class:navbar-bg-visible={isScrolled}></div>

  <div class="app-content">
    <div class="main-container">
      <!-- Lava Lamp Background Effect -->
      <div class="lava-bg">
        <div class="lava-blob lava-blob-1"></div>
        <div class="lava-blob lava-blob-2"></div>
        <div class="lava-blob lava-blob-3"></div>
        <div class="lava-blob lava-blob-4"></div>
        <div class="lava-blob lava-blob-5"></div>
      </div>

      <div class="main-content">
        <Navbar unreadCount={data.unreadCount} />

        <main class="flex-1">
          {@render children()}
        </main>
      </div>
    </div>

    <Footer />
  </div>

  <!-- Global Toast Container -->
  <Toast />
</div>

<style>
  .app-wrapper {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--background);
    overflow-x: hidden;
  }

  /* Lava Lamp Background - Clean, Subtle Design */
  .lava-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }

  .lava-blob {
    position: absolute;
    border-radius: 50%;
    backface-visibility: hidden;
    transform: translateZ(0);
    will-change: transform, filter;
  }

  /*
   * Light Mode Design Principles:
   * - Moderate saturation (chroma 0.06-0.10) for visible but soft colors
   * - High lightness (88-93%) for gentle warmth
   * - Warm peach/coral/amber palette
   * - Medium opacity (50-65%) for visible blobs
   * - Moderate blur (60-80px) for soft but recognizable shapes
   */

  .lava-blob-1 {
    width: 700px;
    height: 700px;
    background: radial-gradient(circle, oklch(90% 0.08 55) 0%, transparent 65%);
    top: -20%;
    right: -15%;
    opacity: 0.55;
    filter: blur(70px);
    animation: lava-1 30s ease-in-out infinite;
  }

  .lava-blob-2 {
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, oklch(92% 0.06 75) 0%, transparent 65%);
    top: 20%;
    left: -20%;
    opacity: 0.5;
    filter: blur(80px);
    animation: lava-2 35s ease-in-out infinite;
  }

  .lava-blob-3 {
    width: 550px;
    height: 550px;
    background: radial-gradient(circle, oklch(88% 0.10 40) 0%, transparent 65%);
    bottom: 30%;
    right: -10%;
    opacity: 0.5;
    filter: blur(65px);
    animation: lava-3 25s ease-in-out infinite;
  }

  .lava-blob-4 {
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, oklch(91% 0.07 65) 0%, transparent 65%);
    top: 55%;
    left: 15%;
    opacity: 0.45;
    filter: blur(75px);
    animation: lava-4 40s ease-in-out infinite;
  }

  .lava-blob-5 {
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, oklch(89% 0.08 50) 0%, transparent 65%);
    bottom: -10%;
    left: -10%;
    opacity: 0.5;
    filter: blur(70px);
    animation: lava-5 32s ease-in-out infinite;
  }

  /* Dark mode - richer, deeper colors with more blur */
  :global(.dark) .lava-blob {
    filter: blur(100px);
  }

  :global(.dark) .lava-blob-1 {
    background: radial-gradient(circle, oklch(35% 0.14 55) 0%, transparent 65%);
    opacity: 0.35;
  }

  :global(.dark) .lava-blob-2 {
    background: radial-gradient(circle, oklch(32% 0.10 75) 0%, transparent 65%);
    opacity: 0.3;
  }

  :global(.dark) .lava-blob-3 {
    background: radial-gradient(circle, oklch(34% 0.12 40) 0%, transparent 65%);
    opacity: 0.32;
  }

  :global(.dark) .lava-blob-4 {
    background: radial-gradient(circle, oklch(30% 0.08 65) 0%, transparent 65%);
    opacity: 0.28;
  }

  :global(.dark) .lava-blob-5 {
    background: radial-gradient(circle, oklch(33% 0.12 50) 0%, transparent 65%);
    opacity: 0.3;
  }

  @keyframes lava-1 {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
    25% { transform: translate3d(-100px, 120px, 0) scale(1.08); }
    50% { transform: translate3d(-50px, 250px, 0) scale(0.95); }
    75% { transform: translate3d(80px, 100px, 0) scale(1.03); }
  }

  @keyframes lava-2 {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
    20% { transform: translate3d(120px, -80px, 0) scale(1.1); }
    40% { transform: translate3d(180px, 100px, 0) scale(0.92); }
    60% { transform: translate3d(90px, 180px, 0) scale(1.05); }
    80% { transform: translate3d(-40px, 80px, 0) scale(0.97); }
  }

  @keyframes lava-3 {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
    33% { transform: translate3d(-120px, -100px, 0) scale(1.12); }
    66% { transform: translate3d(90px, -60px, 0) scale(0.9); }
  }

  @keyframes lava-4 {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
    25% { transform: translate3d(-110px, -120px, 0) scale(1.08); }
    50% { transform: translate3d(120px, -100px, 0) scale(0.92); }
    75% { transform: translate3d(60px, 80px, 0) scale(1.06); }
  }

  @keyframes lava-5 {
    0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
    20% { transform: translate3d(150px, -100px, 0) scale(1.08); }
    40% { transform: translate3d(100px, -180px, 0) scale(0.93); }
    60% { transform: translate3d(-80px, -120px, 0) scale(1.1); }
    80% { transform: translate3d(-50px, 60px, 0) scale(0.96); }
  }

  /* Navbar Background - covers full navbar height, fades based on scroll */
  .navbar-bg {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 6rem;
    background: linear-gradient(
      to bottom,
      var(--background) 0%,
      var(--background) 70%,
      transparent 100%
    );
    pointer-events: none;
    z-index: 45;
    opacity: 0;
    transition: opacity 0.25s ease;
  }

  .navbar-bg-visible {
    opacity: 1;
  }

  /* App Content */
  .app-content {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  /* Main Container with Cute Shadow */
  .main-container {
    position: relative;
    background: var(--background);
    border-radius: 0 0 2rem 2rem;
    box-shadow: 0 8px 0 0 oklch(88% 0.01 75);
    margin-bottom: 1rem;
    min-height: calc(100vh - 4rem);
    min-height: calc(100dvh - 4rem);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  :global(.dark) .main-container {
    box-shadow: 0 8px 0 0 oklch(15% 0.01 75);
  }

  /* Main Content - above lava background and navbar-bg */
  .main-content {
    position: relative;
    z-index: 46;
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  /* Footer Adjustments */
  .app-content :global(footer) {
    margin-top: -1.75rem;
    padding-top: 1.5rem;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* Responsive */
  @media (max-width: 768px) {
    .lava-blob {
      filter: blur(50px);
    }

    .lava-blob-1 {
      width: 400px;
      height: 400px;
      opacity: 0.5;
    }

    .lava-blob-2 {
      width: 350px;
      height: 350px;
      opacity: 0.45;
    }

    .lava-blob-3 {
      width: 300px;
      height: 300px;
      opacity: 0.45;
    }

    .lava-blob-4,
    .lava-blob-5 {
      display: none;
    }

    :global(.dark) .lava-blob {
      filter: blur(70px);
    }

    :global(.dark) .lava-blob-1,
    :global(.dark) .lava-blob-2,
    :global(.dark) .lava-blob-3 {
      opacity: 0.25;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .lava-blob {
      animation: none;
    }
  }
</style>
