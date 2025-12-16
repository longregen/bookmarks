import { defineConfig } from 'vite';
import { sharedDefine } from './vite.config.shared';

/**
 * Vite configuration for the standalone web version.
 * This builds a simple webpage that can be opened directly in a browser
 * without requiring a browser extension.
 */
export default defineConfig({
  root: 'src/web',
  base: './',
  define: {
    ...sharedDefine,
    // Web version doesn't need browser-specific flags
    __IS_CHROME__: JSON.stringify(false),
    __IS_FIREFOX__: JSON.stringify(false),
    __IS_WEB__: JSON.stringify(true),
  },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        web: 'src/web/web.html',
      },
    },
  },
  server: {
    port: 5174,
    open: '/web.html',
  },
});
