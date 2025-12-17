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
export const sharedOutput: OutputOptions = {
  manualChunks(id) {
    // Split vendor dependencies by usage pattern for optimal code splitting
    if (id.includes('node_modules')) {
      // Database (dexie) - used by all pages that access bookmarks
      if (id.includes('dexie')) {
        return 'vendor-db';
      }
      // Content extraction - only needed for capture operations
      if (id.includes('@mozilla/readability') || id.includes('turndown')) {
        return 'vendor-capture';
      }
      // Markdown rendering - only needed for displaying formatted content
      if (id.includes('marked')) {
        return 'vendor-markdown';
      }
      // Other vendor code (should be minimal)
      return 'vendor';
    }
    // UI components must be separate from shared to keep DOM code out of service worker
    if (id.includes('/src/ui/')) {
      return 'ui';
    }
    // Library code goes in 'lib' chunk - these are pure functions with no side effects
    // IMPORTANT: This must be separate from service-worker to prevent side effects
    // from running when offscreen/popup documents import library functions
    if (id.includes('/src/lib/')) {
      return 'lib';
    }
    // Theme utilities have DOM manipulation, keep with UI
    if (id.includes('/src/shared/')) {
      return 'ui';
    }
    // Database schema in its own chunk to avoid bundling with service worker side effects
    if (id.includes('/src/db/')) {
      return 'lib';
    }
    // Service worker entry point - do NOT put in shared chunk
    // Let it be bundled as its own entry point to avoid side effects
    // running in other contexts (offscreen, popup, etc.)
    if (id.includes('/src/background/service-worker')) {
      return undefined; // Let rollup handle as entry point
    }
    // Other background modules (queue, processor, etc.)
    if (id.includes('/src/background/')) {
      return 'lib';
    }
    if (id.includes('/src/web/init-web')) {
      return 'lib';
    }
    if (id.includes('/src/options/modules/')) {
      return 'options-modules';
    }
  },
};

export const sharedConfig: Partial<UserConfig> = {
  define: sharedDefine,
  build: {
    sourcemap: false,
  },
};
