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
 * Chrome Offscreen API type definitions
 * These are not yet in @types/chrome for Manifest V3
 */
declare namespace chrome.offscreen {
  export type Reason =
    | 'AUDIO_PLAYBACK'
    | 'BLOBS'
    | 'CLIPBOARD'
    | 'DOM_PARSER'
    | 'DOM_SCRAPING'
    | 'GEOLOCATION'
    | 'IFRAME_SCRIPTING'
    | 'LOCAL_STORAGE'
    | 'MEDIA_STREAM'
    | 'MICROPHONE'
    | 'TESTING'
    | 'USER_MEDIA'
    | 'WEB_RTC'
    | 'WORKERS';

  export interface CreateParameters {
    url: string;
    reasons: Reason[];
    justification: string;
  }

  export function createDocument(parameters: CreateParameters): Promise<void>;
  export function closeDocument(): Promise<void>;
  export function hasDocument(): Promise<boolean>;
}

/**
 * Chrome Runtime API extensions for getContexts (Chrome 116+)
 */
declare namespace chrome.runtime {
  export type ContextType =
    | 'TAB'
    | 'POPUP'
    | 'BACKGROUND'
    | 'OFFSCREEN_DOCUMENT'
    | 'SIDE_PANEL'
    | 'DEVELOPER_TOOLS';

  export interface ContextFilter {
    contextTypes?: ContextType[];
    contextIds?: string[];
    documentIds?: string[];
    documentUrls?: string[];
    frameIds?: number[];
    incognito?: boolean;
    tabIds?: number[];
    windowIds?: number[];
  }

  export interface ExtensionContext {
    contextType: ContextType;
    contextId: string;
    tabId: number;
    windowId: number;
    documentId?: string;
    frameId: number;
    documentUrl?: string;
    documentOrigin?: string;
    incognito: boolean;
  }

  export function getContexts(filter: ContextFilter): Promise<ExtensionContext[]>;
}
