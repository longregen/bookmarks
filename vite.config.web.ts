import { defineConfig } from 'vite';
import { sharedDefine } from './vite.config.shared';

export default defineConfig({
  define: {
    ...sharedDefine,
    __IS_CHROME__: JSON.stringify(false),
    __IS_FIREFOX__: JSON.stringify(false),
  },
  base: '/webapp/',
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: {
        index: 'src/web/index.html',
        library: 'src/library/library.html',
        search: 'src/search/search.html',
        stumble: 'src/stumble/stumble.html',
        options: 'src/options/options.html',
      },
    },
  },
});
