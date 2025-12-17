import type { UserConfig } from 'vite';
import type { OutputOptions } from 'rollup';

/**
 * Shared Vite configuration for both Chrome and Firefox builds.
 *
 * Build-time flags:
 * - __DEBUG_EMBEDDINGS__: Enable verbose logging for embedding generation and search.
 *   Set to `true` by default (beta mode). Set to `false` for production releases
 *   when you want to reduce console noise.
 * - __IS_CHROME__: true when building for Chrome, false otherwise
 * - __IS_FIREFOX__: true when building for Firefox, false otherwise
 *
 * Use these flags to conditionally compile browser-specific code:
 *   if (__IS_CHROME__) { ... } // Dead code eliminated in Firefox builds
 */
export const sharedDefine = {
  __DEBUG_EMBEDDINGS__: JSON.stringify(false),
};

// Files that use DOM APIs (document/window) must NOT be in the shared chunk
// because they would crash the service worker which has no DOM
const DOM_DEPENDENT_FILES = [
  'dom.ts',
  'export.ts',
  'bookmark-detail.ts',
  'form-helper.ts',
  'health-indicator.ts',
  'tag-editor.ts',
  'tag-filter.ts',
  'theme.ts',
  'init-extension.ts', // imports theme.ts
  'webdav-sync.ts', // imports export.ts
];

function isDomDependent(id: string): boolean {
  return DOM_DEPENDENT_FILES.some(file => id.endsWith(`/${file}`));
}

/**
 * Shared rollup output options for bundling JavaScript.
 *
 * This configuration consolidates JavaScript into optimized chunks for better
 * compression and caching while avoiding too many small files.
 */
export const sharedOutput: OutputOptions = {
  manualChunks(id) {
    if (id.includes('node_modules')) {
      return 'vendor';
    }
    // DOM-dependent files get their own chunk, loaded only by UI pages
    if (isDomDependent(id)) {
      return 'ui';
    }
    if (id.includes('/src/lib/')) {
      return 'shared';
    }
    if (id.includes('/src/shared/')) {
      return 'shared';
    }
    // Database schema must be in shared to avoid circular dependencies
    if (id.includes('/src/db/')) {
      return 'shared';
    }
    // Background modules (queue, processor, etc.) must be in shared
    // to prevent service worker from importing options-modules
    // EXCEPT service-worker.ts which has initialization code that should
    // only run in the service worker context
    if (id.includes('/src/background/') && !id.includes('service-worker.ts')) {
      return 'shared';
    }
    if (id.includes('/src/web/init-web')) {
      return 'shared';
    }
    if (id.includes('/src/options/modules/')) {
      return 'options-modules';
    }
  },
};

export const sharedConfig: Partial<UserConfig> = {
  define: sharedDefine,
};
