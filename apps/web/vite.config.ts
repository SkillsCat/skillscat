import { sveltekit } from '@sveltejs/kit/vite';
import UnoCSS from '@unocss/svelte-scoped/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        const isHugeiconsAnnotationNoise = typeof warning.message === 'string'
          && warning.message.includes('annotation that Rollup cannot interpret due to the position of the comment')
          && typeof warning.id === 'string'
          && warning.id.includes('@hugeicons/core-free-icons');

        if (isHugeiconsAnnotationNoise) {
          return;
        }

        defaultHandler(warning);
      }
    }
  },
  plugins: [
    UnoCSS({
      injectReset: '@unocss/reset/tailwind.css'
    }),
    sveltekit()
  ]
});
