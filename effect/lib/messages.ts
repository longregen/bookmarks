import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import type { EventData } from '../../src/lib/events';

// ============================================================================
// Message Types (unchanged from original)
// ============================================================================

export interface BookmarkRetryPayload {
  bookmarkId?: string;
  trigger:
    | 'user_manual'
    | 'auto_backoff'
    | 'settings_changed'
    | 'queue_restart';
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
  | { type: 'sync:update_settings' }
  | { type: 'query:current_tab_info' }
  | { type: 'query:sync_status' }
  | { type: 'query:current_page_dom' }
  | { type: 'offscreen:ready' }
  | { type: 'offscreen:ping' }
  | { type: 'event:broadcast'; event: EventData };

export type Message = Command;

// ============================================================================
// Response Interfaces (unchanged from original)
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

// ============================================================================
// Type Mappings (unchanged from original)
// ============================================================================

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

// ============================================================================
// Typed Errors (Effect.ts pattern)
// ============================================================================

export class MessagingError extends Data.TaggedError('MessagingError')<{
  readonly messageType: MessageType;
  readonly reason: 'runtime_error' | 'no_response' | 'invalid_response' | 'handler_error';
  readonly details?: string;
  readonly originalError?: unknown;
}> {}

// ============================================================================
// MessagingService (Effect.ts pattern with Context.Tag)
// ============================================================================

export class MessagingService extends Context.Tag('MessagingService')<
  MessagingService,
  {
    readonly sendMessage: <T extends MessageType>(
      message: MessageOfType<T>
    ) => Effect.Effect<MessageResponse<T>, MessagingError>;

    readonly addMessageListener: <T extends MessageType>(
      messageType: T,
      handler: (message: MessageOfType<T>) => Effect.Effect<MessageResponse<T>, MessagingError>
    ) => Effect.Effect<() => void, never>;

    readonly broadcastEvent: (event: EventData) => Effect.Effect<void, MessagingError>;
  }
>() {}

// ============================================================================
// Chrome Extension Implementation
// ============================================================================

const makeMessagingServiceChrome = Effect.sync(() => ({
  sendMessage: <T extends MessageType>(message: MessageOfType<T>) =>
    Effect.async<MessageResponse<T>, MessagingError>((resume) => {
      chrome.runtime.sendMessage(message, (response: MessageResponse<T>) => {
        if (chrome.runtime.lastError) {
          resume(
            Effect.fail(
              new MessagingError({
                messageType: message.type,
                reason: 'runtime_error',
                details: chrome.runtime.lastError.message,
                originalError: chrome.runtime.lastError,
              })
            )
          );
          return;
        }

        // Some messages don't expect responses (undefined is valid)
        if (
          response === undefined &&
          message.type !== 'offscreen:ready' &&
          message.type !== 'event:broadcast'
        ) {
          resume(
            Effect.fail(
              new MessagingError({
                messageType: message.type,
                reason: 'no_response',
                details: 'No response received from message handler',
              })
            )
          );
          return;
        }

        resume(Effect.succeed(response));
      });
    }),

  addMessageListener: <T extends MessageType>(
    messageType: T,
    handler: (message: MessageOfType<T>) => Effect.Effect<MessageResponse<T>, MessagingError>
  ) =>
    Effect.sync(() => {
      const listener = (
        message: Message,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: MessageResponse<T>) => void
      ) => {
        if (message.type === messageType) {
          // Run the effect-based handler and convert to Promise for Chrome API
          Effect.runPromise(handler(message as MessageOfType<T>))
            .then((response) => {
              sendResponse(response);
            })
            .catch((error) => {
              console.error(`Message handler error for ${messageType}:`, error);
              // Try to send an error response based on the message type
              const errorResponse = {
                success: false,
                error:
                  error instanceof MessagingError
                    ? error.details || 'Unknown messaging error'
                    : error instanceof Error
                      ? error.message
                      : 'Unknown error',
              } as MessageResponse<T>;
              sendResponse(errorResponse);
            });

          // Return true to indicate async response
          return true;
        }
        return false;
      };

      chrome.runtime.onMessage.addListener(listener);

      // Return cleanup function
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
      };
    }),

  broadcastEvent: (event: EventData) =>
    Effect.gen(function* () {
      const message: MessageOfType<'event:broadcast'> = {
        type: 'event:broadcast',
        event,
      };

      return yield* Effect.async<void, MessagingError>((resume) => {
        chrome.runtime.sendMessage(message, () => {
          if (chrome.runtime.lastError) {
            // Ignore errors for broadcast messages (listeners might not exist)
            resume(Effect.succeed(undefined));
            return;
          }
          resume(Effect.succeed(undefined));
        });
      });
    }),
}));

// ============================================================================
// Layers
// ============================================================================

export const MessagingServiceChromeLayer: Layer.Layer<MessagingService, never> =
  Layer.effect(MessagingService, makeMessagingServiceChrome);

// ============================================================================
// Convenience Functions (backward compatibility with original API)
// ============================================================================

/**
 * Send a message through the MessagingService.
 * This is the Effect.ts equivalent of the original sendMessage function.
 *
 * @example
 * ```ts
 * const effect = sendMessage({ type: 'query:current_tab_info' });
 * const result = await Effect.runPromise(effect, MessagingServiceChromeLayer);
 * ```
 */
export const sendMessage = <T extends MessageType>(
  message: MessageOfType<T>
): Effect.Effect<MessageResponse<T>, MessagingError, MessagingService> =>
  Effect.flatMap(MessagingService, (service) => service.sendMessage(message));

/**
 * Type alias for message handlers.
 * Handlers now return Effects instead of Promises.
 */
export type MessageHandler<T extends MessageType> = (
  message: MessageOfType<T>
) => Effect.Effect<MessageResponse<T>, MessagingError>;

/**
 * Add a message listener using the MessagingService.
 *
 * @example
 * ```ts
 * const effect = addMessageListener('bookmark:retry', (msg) =>
 *   Effect.succeed({ success: true })
 * );
 * const cleanup = await Effect.runPromise(effect, MessagingServiceChromeLayer);
 * // Later: cleanup();
 * ```
 */
export const addMessageListener = <T extends MessageType>(
  messageType: T,
  handler: MessageHandler<T>
): Effect.Effect<() => void, never, MessagingService> =>
  Effect.flatMap(MessagingService, (service) => service.addMessageListener(messageType, handler));

/**
 * Broadcast an event to all listeners.
 *
 * @example
 * ```ts
 * const effect = broadcastEvent({
 *   type: 'bookmark:created',
 *   timestamp: new Date().toISOString(),
 *   data: { bookmarkId: '123' },
 * });
 * await Effect.runPromise(effect, MessagingServiceChromeLayer);
 * ```
 */
export const broadcastEvent = (
  event: EventData
): Effect.Effect<void, MessagingError, MessagingService> =>
  Effect.flatMap(MessagingService, (service) => service.broadcastEvent(event));
