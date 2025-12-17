import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { chromeManifest } from './manifest.base';
import { createDefine, extensionInput, sharedOutput } from './vite.config.shared';

export default defineConfig({
  define: createDefine('chrome'),
  plugins: [crx({ manifest: chromeManifest })],
  build: {
    outDir: 'dist-chrome',
    sourcemap: true,
    rollupOptions: {
      input: {
        ...extensionInput,
        offscreen: 'src/offscreen/offscreen.html',
      },
      output: sharedOutput,
    },
  },
});
