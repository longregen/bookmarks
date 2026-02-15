import type { EventData } from './events';
import type { ExtractedContent } from './extract';
import type { SyncStatus } from './server-sync';
export interface BookmarkRetryPayload {
  bookmarkId?: string;           // specific bookmark, or undefined for all failed
  trigger:
    | 'user_manual'              // clicked retry button in UI
    | 'auto_backoff'             // automatic retry after delay
    | 'settings_changed'         // API settings updated
    | 'queue_restart';           // general queue restart
  previousError?: string;
  attemptNumber?: number;
}

export type Command =
  | { type: 'user_request:capture_current_tab' }
  | { type: 'bookmark:save_from_page'; data: { url: string; title: string; html: string } }
  | { type: 'bookmark:retry'; data: BookmarkRetryPayload }
  | { type: 'import:create_from_url_list'; urls: string[] }
  | { type: 'extract:markdown_from_html'; html: string; url: string }
  | { type: 'sync:trigger' }
  | { type: 'sync:upload_all' }
  | { type: 'sync:update_settings' }
  | { type: 'query:current_tab_info' }
  | { type: 'query:sync_status' }
  | { type: 'query:current_page_dom' }
  | { type: 'bookmark:reprocess_all' }
  | { type: 'offscreen:ready' }
  | { type: 'offscreen:ping' }
  | { type: 'event:broadcast'; event: EventData };

export type Message = Command;

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

export interface TriggerSyncResponse {
  success: boolean;
  action?: 'uploaded' | 'downloaded' | 'no-change' | 'skipped' | 'error';
  message?: string;
  timestamp?: string;
  bookmarkCount?: number;
  error?: string;
}

export interface SyncUploadAllResponse {
  success: boolean;
  jobId?: string;
  message?: string;
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

export interface ReprocessAllResponse {
  success: boolean;
  count?: number;
  error?: string;
}

export interface OffscreenReadyResponse {
  ready: true;
}

export type MessageType = Message['type'];

export type MessageOfType<T extends MessageType> = Extract<Message, { type: T }>;

export type MessageResponse<T extends MessageType> =
  T extends 'bookmark:save_from_page' ? SaveBookmarkResponse
  : T extends 'import:create_from_url_list' ? StartBulkImportResponse
  : T extends 'query:current_tab_info' ? TabInfo
  : T extends 'bookmark:retry' ? StartProcessingResponse
  : T extends 'bookmark:reprocess_all' ? ReprocessAllResponse
  : T extends 'sync:trigger' ? TriggerSyncResponse
  : T extends 'sync:upload_all' ? SyncUploadAllResponse
  : T extends 'query:sync_status' ? SyncStatus
  : T extends 'sync:update_settings' ? UpdateSyncSettingsResponse
  : T extends 'extract:markdown_from_html' ? ExtractContentResponse
  : T extends 'user_request:capture_current_tab' ? CapturePageResponse
  : T extends 'query:current_page_dom' ? GetPageHtmlResponse
  : T extends 'offscreen:ready' ? undefined
  : T extends 'offscreen:ping' ? OffscreenReadyResponse
  : T extends 'event:broadcast' ? undefined
  : never;

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
