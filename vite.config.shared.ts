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
  // Set to false to disable all embedding-related console.log statements
  __DEBUG_EMBEDDINGS__: JSON.stringify(false),
};

/**
 * Shared rollup output options for bundling JavaScript.
 *
 * This configuration consolidates JavaScript into fewer chunks to reduce HTTP requests:
 * - 'vendor': All node_modules dependencies (dexie, readability, marked, turndown)
 * - 'shared': All shared library code from src/lib/
 * - Entry points get their own minimal bundles that import from shared chunks
 */
export const sharedOutput: OutputOptions = {
  manualChunks(id) {
    // Bundle all node_modules into a single vendor chunk
    if (id.includes('node_modules')) {
      return 'vendor';
    }
    // Bundle all shared library code into a single chunk
    if (id.includes('/src/lib/')) {
      return 'shared';
    }
    // Bundle shared theme/utilities
    if (id.includes('/src/shared/')) {
      return 'shared';
    }
    // Bundle options modules together
    if (id.includes('/src/options/modules/')) {
      return 'options-modules';
    }
  },
};

export const sharedConfig: Partial<UserConfig> = {
  define: sharedDefine,
};
