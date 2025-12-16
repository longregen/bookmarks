/**
 * Build-time constants defined in vite.config.*.ts
 *
 * These values are replaced at build time by Vite's `define` option.
 * Use these flags to conditionally compile browser-specific code.
 * Dead code paths are eliminated during minification.
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

/**
 * True when building for Chrome (ManifestV3 with offscreen API).
 * Use this to conditionally include Chrome-specific code like offscreen document handling.
 *
 * @example
 * if (__IS_CHROME__) {
 *   // This code is eliminated from Firefox builds
 *   await chrome.offscreen.createDocument({ ... });
 * }
 */
declare const __IS_CHROME__: boolean;

/**
 * True when building for Firefox.
 * Use this to conditionally include Firefox-specific code.
 * Firefox service workers have DOMParser available natively.
 *
 * @example
 * if (__IS_FIREFOX__) {
 *   // This code is eliminated from Chrome builds
 *   const parser = new DOMParser();
 * }
 */
declare const __IS_FIREFOX__: boolean;

/**
 * True when building for Web (standalone web app).
 * Use this to conditionally include web-specific code that doesn't use
 * browser extension APIs like chrome.runtime.
 *
 * @example
 * if (__IS_WEB__) {
 *   // This code is eliminated from extension builds
 *   // Handle bulk import directly without service worker
 * }
 */
declare const __IS_WEB__: boolean;

/**
 * Chrome MV3 API type extensions
 * These types extend the Chrome API to include newer MV3-specific features
 * that may not be in the @types/chrome package yet.
 */
declare namespace chrome {
  export namespace offscreen {
    export type Reason = 'DOM_SCRAPING' | 'CLIPBOARD' | 'AUDIO_PLAYBACK' | 'IFRAME_SCRIPTING' | 'WEB_RTC' | 'BLOBS' | 'DOM_PARSER' | 'WORKERS' | 'BATTERY_STATUS' | 'MATCH_MEDIA' | 'GEOLOCATION';

    export interface CreateParameters {
      url: string;
      reasons: Reason[];
      justification: string;
    }

    export function createDocument(parameters: CreateParameters): Promise<void>;
    export function closeDocument(): Promise<void>;
    export function hasDocument(): Promise<boolean>;
  }

  export namespace runtime {
    export type ContextType = 'TAB' | 'POPUP' | 'BACKGROUND' | 'OFFSCREEN_DOCUMENT' | 'SIDE_PANEL' | 'DEVELOPER_TOOLS';

    export interface ContextFilter {
      contextTypes?: ContextType[];
      contextIds?: string[];
      documentUrls?: string[];
      frameIds?: number[];
      tabIds?: number[];
      windowIds?: number[];
      incognito?: boolean;
    }

    export interface ExtensionContext {
      contextType: ContextType;
      contextId: string;
      documentUrl?: string;
      frameId: number;
      tabId: number;
      windowId: number;
      incognito: boolean;
    }

    export function getContexts(filter: ContextFilter): Promise<ExtensionContext[]>;
  }
}
