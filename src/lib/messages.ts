import type { EventData } from './events';

// Retry payload with trigger information
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

// Commands - requests for action
export type Command =
  // User-initiated
  | { type: 'user_request:capture_current_tab' }

  // Bookmark operations
  | { type: 'bookmark:save_from_page'; data: { url: string; title: string; html: string } }
  | { type: 'bookmark:retry'; data: BookmarkRetryPayload }

  // Import operations
  | { type: 'import:create_from_url_list'; urls: string[] }

  // Browser operations (internal)
  | { type: 'extract:markdown_from_html'; html: string; url: string }

  // Sync operations
  | { type: 'sync:trigger' }
  | { type: 'sync:update_settings' }

  // Queries
  | { type: 'query:current_tab_info' }
  | { type: 'query:sync_status' }
  | { type: 'query:current_page_dom' }

  // Offscreen document lifecycle (internal)
  | { type: 'offscreen:ready' }
  | { type: 'offscreen:ping' }

  // Event broadcasting transport
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
  T extends 'bookmark:save_from_page' ? SaveBookmarkResponse
  : T extends 'import:create_from_url_list' ? StartBulkImportResponse
  : T extends 'query:current_tab_info' ? TabInfo
  : T extends 'bookmark:retry' ? StartProcessingResponse
  : T extends 'sync:trigger' ? TriggerSyncResponse
  : T extends 'query:sync_status' ? SyncStatus
  : T extends 'sync:update_settings' ? UpdateSyncSettingsResponse
  : T extends 'extract:markdown_from_html' ? ExtractContentResponse
  : T extends 'user_request:capture_current_tab' ? CapturePageResponse
  : T extends 'query:current_page_dom' ? GetPageHtmlResponse
  : T extends 'offscreen:ready' ? undefined
  : T extends 'offscreen:ping' ? OffscreenReadyResponse
  : T extends 'event:broadcast' ? undefined
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
