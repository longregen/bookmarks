import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.chrome.json';
import { sharedDefine } from './vite.config.shared';

export default defineConfig({
  define: {
    ...sharedDefine,
    __IS_CHROME__: JSON.stringify(true),
    __IS_FIREFOX__: JSON.stringify(false),
  },
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist-chrome',
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html',
        options: 'src/options/options.html',
        explore: 'src/explore/explore.html',
        offscreen: 'src/offscreen/offscreen.html',
      },
    },
  },
});
