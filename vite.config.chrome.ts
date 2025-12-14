import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.chrome.json';
import { sharedConfig } from './vite.config.shared';

export default defineConfig({
  ...sharedConfig,
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
