/**
 * Build-time constants defined in vite.config.shared.ts
 *
 * These values are replaced at build time by Vite's `define` option.
 */

/**
 * Enable verbose debug logging for the embeddings pipeline.
 *
 * When true, logs detailed information about:
 * - Embedding API requests and responses
 * - Embedding dimensions and validation
 * - Search query processing and similarity scores
 * - Filter statistics and threshold results
 *
 * Controlled via vite.config.shared.ts - set to false for production
 * releases when console noise should be minimized.
 *
 * @default true (beta mode)
 */
declare const __DEBUG_EMBEDDINGS__: boolean;
