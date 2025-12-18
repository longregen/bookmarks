import type { EventData } from './events';

export type Message =
  | { type: 'SAVE_BOOKMARK'; data: { url: string; title: string; html: string } }
  | { type: 'CAPTURE_PAGE' }
  | { type: 'GET_PAGE_HTML' }
  | { type: 'START_BULK_IMPORT'; urls: string[] }
  | { type: 'GET_CURRENT_TAB_INFO' }
  | { type: 'START_PROCESSING' }
  | { type: 'TRIGGER_SYNC' }
  | { type: 'GET_SYNC_STATUS' }
  | { type: 'UPDATE_SYNC_SETTINGS' }
  // Offscreen document operations (Chrome only)
  | { type: 'FETCH_URL'; url: string; timeoutMs?: number }
  | { type: 'EXTRACT_CONTENT'; html: string; url: string }
  | { type: 'OFFSCREEN_READY' }
  | { type: 'OFFSCREEN_PING' }
  | { type: 'EVENT_BROADCAST'; event: EventData };

export interface SaveBookmarkResponse {
  success: boolean;
  bookmarkId?: string;
  updated?: boolean;
  error?: string;
}

export interface StartBulkImportResponse {
  success: boolean;
  jobId?: string;
  totalUrls?: number;
  error?: string;
}

export interface TabInfo {
  url?: string;
  title?: string;
  error?: string;
}

export interface StartProcessingResponse {
  success: boolean;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  lastSyncError: string | null;
  isSyncing: boolean;
}

export interface TriggerSyncResponse {
  success: boolean;
  action?: 'uploaded' | 'downloaded' | 'no-change' | 'skipped' | 'error';
  message?: string;
  timestamp?: string;
  bookmarkCount?: number;
  error?: string;
}

export interface UpdateSyncSettingsResponse {
  success: boolean;
}

export interface FetchUrlResponse {
  success: boolean;
  html?: string;
  error?: string;
}

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string | null;
}

export interface ExtractContentResponse {
  success: boolean;
  result?: ExtractedContent;
  error?: string;
}

export interface CapturePageResponse {
  success: boolean;
}

export interface GetPageHtmlResponse {
  success: boolean;
  html?: string;
  error?: string;
}

export interface OffscreenReadyResponse {
  ready: true;
}

export type MessageType = Message['type'];

export type MessageOfType<T extends MessageType> = Extract<Message, { type: T }>;

export type MessageResponse<T extends MessageType> =
  T extends 'SAVE_BOOKMARK' ? SaveBookmarkResponse
  : T extends 'START_BULK_IMPORT' ? StartBulkImportResponse
  : T extends 'GET_CURRENT_TAB_INFO' ? TabInfo
  : T extends 'START_PROCESSING' ? StartProcessingResponse
  : T extends 'TRIGGER_SYNC' ? TriggerSyncResponse
  : T extends 'GET_SYNC_STATUS' ? SyncStatus
  : T extends 'UPDATE_SYNC_SETTINGS' ? UpdateSyncSettingsResponse
  : T extends 'FETCH_URL' ? FetchUrlResponse
  : T extends 'EXTRACT_CONTENT' ? ExtractContentResponse
  : T extends 'CAPTURE_PAGE' ? CapturePageResponse
  : T extends 'GET_PAGE_HTML' ? GetPageHtmlResponse
  : T extends 'OFFSCREEN_READY' ? undefined
  : T extends 'OFFSCREEN_PING' ? OffscreenReadyResponse
  : T extends 'EVENT_BROADCAST' ? undefined
  : never;

export type MessageHandler<T extends MessageType> = (
  message: MessageOfType<T>
) => Promise<MessageResponse<T>>;

export async function sendMessage<T extends MessageType>(
  message: MessageOfType<T>
): Promise<MessageResponse<T>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: MessageResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}
