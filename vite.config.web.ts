import { defineConfig } from 'vite';
import { createDefine, sharedInput, sharedOutput } from './vite.config.shared';

export default defineConfig({
  define: createDefine('web'),
  base: '/webapp/',
  build: {
    outDir: 'dist-web',
    sourcemap: false,
    rollupOptions: {
      input: {
        ...sharedInput,
        index: 'src/web/index.html',
      },
      output: sharedOutput,
    },
  },
});
