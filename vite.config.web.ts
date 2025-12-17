import { defineConfig } from 'vite';
import { createDefine, sharedInput, sharedOutput, sharedBuildOptions } from './vite.config.shared';

export default defineConfig({
  define: createDefine('web'),
  base: '/webapp/',
  build: {
    ...sharedBuildOptions,
    outDir: 'dist-web',
    rollupOptions: {
      input: {
        ...sharedInput,
        index: 'src/web/index.html',
      },
      output: sharedOutput,
    },
  },
});
