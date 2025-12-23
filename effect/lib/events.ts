import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from './effect-utils';
import { getErrorMessage } from '../../src/lib/errors';
import type { Message } from '../../src/lib/messages';

// Template literal types for domain:action enforcement
type BookmarkEvent = `bookmark:${'created' | 'content_fetched' | 'processing_started' | 'status_changed' | 'ready' | 'processing_failed' | 'deleted'}`;
type TagEvent = `tag:${'added' | 'removed'}`;
type JobEvent = `job:${'created' | 'progress_changed' | 'completed' | 'failed'}`;
type SyncEvent = `sync:${'started' | 'completed' | 'failed'}`;

export type EventType = BookmarkEvent | TagEvent | JobEvent | SyncEvent;

// Typed payloads for each event
export interface EventPayloads {
  'bookmark:created': { bookmarkId: string; url: string };
  'bookmark:content_fetched': { bookmarkId: string };
  'bookmark:processing_started': { bookmarkId: string };
  'bookmark:status_changed': { bookmarkId: string; oldStatus?: string; newStatus: string };
  'bookmark:ready': { bookmarkId: string };
  'bookmark:processing_failed': { bookmarkId: string; error: string };
  'bookmark:deleted': { bookmarkId: string };
  'tag:added': { bookmarkId: string; tagName: string };
  'tag:removed': { bookmarkId: string; tagName: string };
  'job:created': { jobId: string; totalItems: number };
  'job:progress_changed': { jobId: string; completedCount: number; totalCount: number };
  'job:completed': { jobId: string };
  'job:failed': { jobId: string; errorCount: number };
  'sync:started': { manual: boolean };
  'sync:completed': { action: 'uploaded' | 'downloaded' | 'no-change'; bookmarkCount?: number };
  'sync:failed': { error: string };
}

export interface EventData {
  type: EventType;
  payload?: unknown;
  timestamp: number;
}

// Typed errors using Data.TaggedError
export class EventBroadcastError extends Data.TaggedError('EventBroadcastError')<{
  readonly eventType: EventType;
  readonly cause: unknown;
}> {}

export class EventListenerError extends Data.TaggedError('EventListenerError')<{
  readonly cause: unknown;
}> {}

// EventService using Context.Tag
export class EventService extends Context.Tag('EventService')<
  EventService,
  {
    readonly broadcastEvent: <T extends EventType>(
      type: T,
      payload: EventPayloads[T]
    ) => Effect.Effect<void, EventBroadcastError, never>;

    readonly addEventListener: (
      listener: (event: EventData) => void
    ) => Effect.Effect<void, never, never>;
  }
>() {}

// Helper to create event data
function createEventData<T extends EventType>(
  type: T,
  payload: EventPayloads[T]
): EventData {
  return {
    type,
    payload,
    timestamp: Date.now(),
  };
}

// Core broadcast implementation as Effect
function broadcastEventImpl<T extends EventType>(
  type: T,
  payload: EventPayloads[T]
): Effect.Effect<void, EventBroadcastError, never> {
  return Effect.gen(function* () {
    const event = createEventData(type, payload);

    // Broadcast via Chrome runtime if available
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage !== undefined) {
      yield* Effect.tryPromise({
        try: () => chrome.runtime.sendMessage({
          type: 'event:broadcast',
          event,
        }),
        catch: (error) => {
          const errorMessage = getErrorMessage(error);
          // Ignore "Receiving end does not exist" errors
          if (errorMessage.includes('Receiving end does not exist')) {
            return null;
          }
          return new EventBroadcastError({ eventType: type, cause: error });
        },
      }).pipe(
        Effect.catchAll((err) => {
          // Silently ignore "no receiver" errors (null cause)
          if (err.cause === null) {
            return Effect.void;
          }
          // Log other errors but don't fail
          return Effect.sync(() => {
            console.error('Error broadcasting event:', err);
          });
        })
      );
    }

    // Broadcast via window custom events if available
    if (typeof window !== 'undefined') {
      yield* Effect.sync(() => {
        window.dispatchEvent(new CustomEvent('bookmark-event', { detail: event }));
      });
    }
  });
}

// addEventListener with Effect.acquireRelease for guaranteed cleanup
function addEventListenerImpl(
  listener: (event: EventData) => void
): Effect.Effect<void, never, never> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const chromeListener = (message: Message): void => {
        if (message.type === 'event:broadcast') {
          listener(message.event);
        }
      };

      const webListener = (e: Event): void => {
        const customEvent = e as CustomEvent<EventData>;
        listener(customEvent.detail);
      };

      // Register Chrome listener
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage !== undefined) {
        chrome.runtime.onMessage.addListener(chromeListener);
      }

      // Register window listener
      if (typeof window !== 'undefined') {
        window.addEventListener('bookmark-event', webListener);
      }

      return { chromeListener, webListener };
    }),
    ({ chromeListener, webListener }) =>
      Effect.sync(() => {
        // Cleanup Chrome listener
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage !== undefined) {
          chrome.runtime.onMessage.removeListener(chromeListener);
        }
        // Cleanup window listener
        if (typeof window !== 'undefined') {
          window.removeEventListener('bookmark-event', webListener);
        }
      })
  ).pipe(Effect.asVoid);
}

// EventService Layer implementation
export const EventServiceLive: Layer.Layer<EventService, never, never> = makeLayer(
  EventService,
  {
    broadcastEvent: broadcastEventImpl,
    addEventListener: addEventListenerImpl,
  }
);

// Legacy API compatibility - returns cleanup function
export function addEventListener(listener: (event: EventData) => void): () => void {
  const chromeListener = (message: Message): void => {
    if (message.type === 'event:broadcast') {
      listener(message.event);
    }
  };

  const webListener = (e: Event): void => {
    const customEvent = e as CustomEvent<EventData>;
    listener(customEvent.detail);
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage !== undefined) {
    chrome.runtime.onMessage.addListener(chromeListener);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('bookmark-event', webListener);
  }

  return (): void => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage !== undefined) {
      chrome.runtime.onMessage.removeListener(chromeListener);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('bookmark-event', webListener);
    }
  };
}

// Legacy API compatibility - async function
export async function broadcastEvent<T extends EventType>(
  type: T,
  payload: EventPayloads[T]
): Promise<void> {
  return Effect.runPromise(
    broadcastEventImpl(type, payload).pipe(
      Effect.catchAll(() => Effect.void)
    )
  );
}

// Type-safe event builder functions (maintain compatibility with original)
export const events = {
  bookmark: {
    created: (bookmarkId: string, url: string) =>
      broadcastEvent('bookmark:created', { bookmarkId, url }),
    contentFetched: (bookmarkId: string) =>
      broadcastEvent('bookmark:content_fetched', { bookmarkId }),
    processingStarted: (bookmarkId: string) =>
      broadcastEvent('bookmark:processing_started', { bookmarkId }),
    statusChanged: (bookmarkId: string, newStatus: string, oldStatus?: string) =>
      broadcastEvent('bookmark:status_changed', { bookmarkId, newStatus, oldStatus }),
    ready: (bookmarkId: string) =>
      broadcastEvent('bookmark:ready', { bookmarkId }),
    processingFailed: (bookmarkId: string, error: string) =>
      broadcastEvent('bookmark:processing_failed', { bookmarkId, error }),
    deleted: (bookmarkId: string) =>
      broadcastEvent('bookmark:deleted', { bookmarkId }),
  },
  tag: {
    added: (bookmarkId: string, tagName: string) =>
      broadcastEvent('tag:added', { bookmarkId, tagName }),
    removed: (bookmarkId: string, tagName: string) =>
      broadcastEvent('tag:removed', { bookmarkId, tagName }),
  },
  job: {
    created: (jobId: string, totalItems: number) =>
      broadcastEvent('job:created', { jobId, totalItems }),
    progressChanged: (jobId: string, completedCount: number, totalCount: number) =>
      broadcastEvent('job:progress_changed', { jobId, completedCount, totalCount }),
    completed: (jobId: string) =>
      broadcastEvent('job:completed', { jobId }),
    failed: (jobId: string, errorCount: number) =>
      broadcastEvent('job:failed', { jobId, errorCount }),
  },
  sync: {
    started: (manual: boolean) =>
      broadcastEvent('sync:started', { manual }),
    completed: (action: 'uploaded' | 'downloaded' | 'no-change', bookmarkCount?: number) =>
      broadcastEvent('sync:completed', { action, bookmarkCount }),
    failed: (error: string) =>
      broadcastEvent('sync:failed', { error }),
  },
} as const;

// Type alias for EventListener
export type EventListener = (event: EventData) => void;
