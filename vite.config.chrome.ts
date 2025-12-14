import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.chrome.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist-chrome',
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html',
        options: 'src/options/options.html',
        explore: 'src/explore/explore.html',
      },
    },
  },
});
