import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      $components: fileURLToPath(new URL('./src/lib/components', import.meta.url)),
      $server: fileURLToPath(new URL('./src/lib/server', import.meta.url)),
      $utils: fileURLToPath(new URL('./src/lib/utils', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    root: rootDir,
  },
});
