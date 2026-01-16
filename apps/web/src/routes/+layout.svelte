<script lang="ts">
  import '../app.css';
  import { Navbar, Footer } from '$lib/components';

  let { children } = $props();
</script>

<div class="app-wrapper">
  <!-- Global Background Effect -->
  <div class="global-bg-deco">
    <div class="global-bg-blob global-bg-blob-1"></div>
    <div class="global-bg-blob global-bg-blob-2"></div>
    <div class="global-bg-blob global-bg-blob-3"></div>
  </div>

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
