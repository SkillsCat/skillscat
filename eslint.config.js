import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/.wrangler/**',
      // svelte-eslint-parser can't handle {@html} with <script> tags
      '**/components/common/SEO.svelte',
    ],
  },
  // TypeScript files
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    plugins: {
      'unused-imports': unusedImports,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
    },
  },
  // Svelte files
  {
    files: ['**/*.svelte'],
    plugins: {
      'unused-imports': unusedImports,
      svelte,
    },
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
    },
  },
];
