import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import preserveShebang from 'rollup-plugin-preserve-shebang';

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'esm',
    sourcemap: false
  },
  external: ['commander', 'picocolors', /^node:/],
  plugins: [
    preserveShebang(),
    resolve(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: './dist'
    })
  ]
};
