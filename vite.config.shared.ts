import type { UserConfig } from 'vite';

/**
 * Shared Vite configuration for both Chrome and Firefox builds.
 *
 * Build-time flags:
 * - __DEBUG_EMBEDDINGS__: Enable verbose logging for embedding generation and search.
 *   Set to `true` by default (beta mode). Set to `false` for production releases
 *   when you want to reduce console noise.
 */
export const sharedConfig: Partial<UserConfig> = {
  define: {
    // Enable debug logging for embeddings pipeline (ON by default for beta)
    // Set to false to disable all embedding-related console.log statements
    __DEBUG_EMBEDDINGS__: JSON.stringify(true),
  },
};
