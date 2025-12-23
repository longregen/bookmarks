import { getErrorMessage } from './errors';
import type { Message } from './messages';

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

export async function broadcastEvent<T extends EventType>(
  type: T,
  payload: EventPayloads[T]
): Promise<void> {
  const event: EventData = {
    type,
    payload,
    timestamp: Date.now(),
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage !== undefined) {
    try {
      await chrome.runtime.sendMessage({
        type: 'event:broadcast',
        event,
      });
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      if (!errorMessage.includes('Receiving end does not exist')) {
        console.error('Error broadcasting event:', error);
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bookmark-event', { detail: event }));
  }
}

export type EventListener = (event: EventData) => void;

export function addEventListener(listener: EventListener): () => void {
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

// Type-safe event builder functions
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
