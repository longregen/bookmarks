declare const __DEBUG_EMBEDDINGS__: boolean;

declare const __IS_CHROME__: boolean;

declare const __IS_FIREFOX__: boolean;

declare const __IS_WEB__: boolean;

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
