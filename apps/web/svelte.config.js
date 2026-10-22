import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [
    vitePreprocess()
  ],

  kit: {
    // Inline the small shared/page styles in SSR to remove render-blocking
    // round trips. Larger route styles keep their immutable browser cache.
    inlineStyleThreshold: 32 * 1024,
    adapter: adapter({
      routes: {
        include: ['/*'],
        exclude: ['<all>']
      }
    }),
    alias: {
      $components: 'src/lib/components',
      $server: 'src/lib/server',
      $utils: 'src/lib/utils'
    }
  }
};

export default config;
