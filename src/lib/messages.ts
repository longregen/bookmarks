/**
 * Typed message system for service worker communication
 * All messages use a discriminated union pattern for type safety
 */

import type { EventData } from './events';

// ============================================================================
// Message Type Definitions (Discriminated Union)
// ============================================================================

export type Message =
  // Bookmark saving
  | { type: 'SAVE_BOOKMARK'; data: { url: string; title: string; html: string } }
  | { type: 'CAPTURE_PAGE' }

  // Bulk import
  | { type: 'START_BULK_IMPORT'; urls: string[] }

  // Job status
  | { type: 'GET_JOB_STATUS'; jobId: string }

  // Tab info
  | { type: 'GET_CURRENT_TAB_INFO' }

  // Processing control
  | { type: 'START_PROCESSING' }

  // WebDAV sync
  | { type: 'TRIGGER_SYNC' }
  | { type: 'GET_SYNC_STATUS' }
  | { type: 'UPDATE_SYNC_SETTINGS' }

  // Offscreen document operations (Chrome only)
  | { type: 'FETCH_URL'; url: string; timeoutMs?: number }
  | { type: 'EXTRACT_CONTENT'; html: string; url: string }

  // Event broadcasting
  | { type: 'EVENT_BROADCAST'; event: EventData };

// ============================================================================
// Response Type Definitions
// ============================================================================

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

export interface JobInfo {
  id: string;
  type: string;
  status: string;
  progress: number;
  currentStep?: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface GetJobStatusResponse {
  success: boolean;
  job?: JobInfo;
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

// ============================================================================
// Helper Types for Type-Safe Message Handling
// ============================================================================

/**
 * Extract the message type from a Message union member
 */
export type MessageType = Message['type'];

/**
 * Get the message shape for a specific message type
 */
export type MessageOfType<T extends MessageType> = Extract<Message, { type: T }>;

/**
 * Map message types to their response types
 */
export type MessageResponse<T extends MessageType> =
  T extends 'SAVE_BOOKMARK' ? SaveBookmarkResponse
  : T extends 'START_BULK_IMPORT' ? StartBulkImportResponse
  : T extends 'GET_JOB_STATUS' ? GetJobStatusResponse
  : T extends 'GET_CURRENT_TAB_INFO' ? TabInfo
  : T extends 'START_PROCESSING' ? StartProcessingResponse
  : T extends 'TRIGGER_SYNC' ? TriggerSyncResponse
  : T extends 'GET_SYNC_STATUS' ? SyncStatus
  : T extends 'UPDATE_SYNC_SETTINGS' ? UpdateSyncSettingsResponse
  : T extends 'FETCH_URL' ? FetchUrlResponse
  : T extends 'EXTRACT_CONTENT' ? ExtractContentResponse
  : T extends 'CAPTURE_PAGE' ? CapturePageResponse
  : T extends 'EVENT_BROADCAST' ? void
  : never;

/**
 * Type-safe message handler function
 */
export type MessageHandler<T extends MessageType> = (
  message: MessageOfType<T>
) => Promise<MessageResponse<T>>;

/**
 * Type guard to check if a message is of a specific type
 */
export function isMessageOfType<T extends MessageType>(
  message: Message,
  type: T
): message is MessageOfType<T> {
  return message.type === type;
}

/**
 * Helper to send a typed message via chrome.runtime.sendMessage
 */
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

/**
 * Helper to send a typed message and handle errors
 */
export async function sendMessageSafe<T extends MessageType>(
  message: MessageOfType<T>
): Promise<MessageResponse<T>> {
  try {
    return await sendMessage(message);
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}
