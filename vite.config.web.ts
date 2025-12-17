import { defineConfig } from 'vite';
import { sharedDefine, sharedOutput } from './vite.config.shared';

export default defineConfig({
  define: {
    ...sharedDefine,
    __IS_CHROME__: JSON.stringify(false),
    __IS_FIREFOX__: JSON.stringify(false),
    __IS_WEB__: JSON.stringify(true),
  },
  base: '/webapp/',
  build: {
    outDir: 'dist-web',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: 'src/web/index.html',
        library: 'src/library/library.html',
        search: 'src/search/search.html',
        stumble: 'src/stumble/stumble.html',
        options: 'src/options/options.html',
        jobs: 'src/jobs/jobs.html',
      },
      output: sharedOutput,
    },
  },
});
