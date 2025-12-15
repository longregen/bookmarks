import type { UserConfig } from 'vite';

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

export const sharedConfig: Partial<UserConfig> = {
  define: sharedDefine,
};
