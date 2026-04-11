import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.integration.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    pool: 'forks',
  },
});
