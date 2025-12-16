import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.firefox.json';
import * as fs from 'fs';
import * as path from 'path';
import { sharedDefine, sharedOutput } from './vite.config.shared';

// Plugin to clean up Firefox manifest by removing Chrome-only properties
function firefoxManifestCleanup(): Plugin {
  return {
    name: 'firefox-manifest-cleanup',
    closeBundle() {
      const manifestPath = path.resolve('dist-firefox', 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        // Remove use_dynamic_url from web_accessible_resources (Chrome-only)
        if (manifestContent.web_accessible_resources) {
          manifestContent.web_accessible_resources = manifestContent.web_accessible_resources.map(
            (resource: Record<string, unknown>) => {
              const { use_dynamic_url, ...rest } = resource;
              return rest;
            }
          );
        }

        fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));
      }
    },
  };
}

export default defineConfig({
  define: {
    ...sharedDefine,
    __IS_CHROME__: JSON.stringify(false),
    __IS_FIREFOX__: JSON.stringify(true),
    __IS_WEB__: JSON.stringify(false),
  },
  plugins: [crx({ manifest }), firefoxManifestCleanup()],
  build: {
    outDir: 'dist-firefox',
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html',
        options: 'src/options/options.html',
        library: 'src/library/library.html',
        search: 'src/search/search.html',
        stumble: 'src/stumble/stumble.html',
        jobs: 'src/jobs/jobs.html',
      },
      output: sharedOutput,
    },
  },
});
