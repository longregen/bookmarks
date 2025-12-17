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

/**
 * Shared rollup output options for bundling JavaScript.
 *
 * This configuration consolidates JavaScript into optimized chunks for better
 * compression and caching while avoiding too many small files.
 */
// Let Rollup handle chunking naturally for optimal tree-shaking.
// Avoid manualChunks that force all node_modules into one vendor bundle.
export const sharedOutput: OutputOptions = {};

export const sharedConfig: Partial<UserConfig> = {
  define: sharedDefine,
  build: {
    sourcemap: true,
  },
};
