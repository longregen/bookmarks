import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.chrome.json';
import { sharedDefine } from './vite.config.shared';

export default defineConfig({
  define: {
    ...sharedDefine,
    __IS_CHROME__: JSON.stringify(true),
    __IS_FIREFOX__: JSON.stringify(false),
    __IS_WEB__: JSON.stringify(false),
  },
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist-chrome',
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html',
        options: 'src/options/options.html',
        library: 'src/library/library.html',
        search: 'src/search/search.html',
        stumble: 'src/stumble/stumble.html',
        offscreen: 'src/offscreen/offscreen.html',
      },
    },
  },
});
