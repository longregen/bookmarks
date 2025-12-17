import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.chrome.json';
import { sharedDefine, sharedOutput } from './vite.config.shared';

// Plugin to guard document usage in Vite's preload helper for service worker compatibility
function serviceWorkerPreloadGuard(): Plugin {
  return {
    name: 'service-worker-preload-guard',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.code) {
          // Guard all document API calls in the preload helper
          // The preload helper is inside an if(r&&r.length>0) block, so we need to
          // add an early return if document is undefined
          chunk.code = chunk.code.replace(
            /if\(r&&r\.length>0\)\{/g,
            'if(r&&r.length>0){if(typeof document==="undefined")return Promise.resolve().then(()=>t());'
          );
        }
      }
    },
  };
}

export default defineConfig({
  define: {
    ...sharedDefine,
    __IS_CHROME__: JSON.stringify(true),
    __IS_FIREFOX__: JSON.stringify(false),
    __IS_WEB__: JSON.stringify(false),
  },
  plugins: [crx({ manifest }), serviceWorkerPreloadGuard()],
  build: {
    outDir: 'dist-chrome',
    modulePreload: false, // Disable module preloading - the polyfill uses document which crashes service workers
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html',
        options: 'src/options/options.html',
        library: 'src/library/library.html',
        search: 'src/search/search.html',
        stumble: 'src/stumble/stumble.html',
        jobs: 'src/jobs/jobs.html',
        offscreen: 'src/offscreen/offscreen.html',
      },
      output: sharedOutput,
    },
  },
});
