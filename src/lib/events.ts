import { getErrorMessage } from './errors';
import type { Message } from './messages';

export type EventType =
  // Bookmark lifecycle
  | 'bookmark:created'
  | 'bookmark:content_fetched'
  | 'bookmark:processing_started'
  | 'bookmark:status_changed'
  | 'bookmark:ready'
  | 'bookmark:processing_failed'
  | 'bookmark:deleted'

  // Tags
  | 'tag:added'
  | 'tag:removed'

  // Jobs
  | 'job:created'
  | 'job:progress_changed'
  | 'job:completed'
  | 'job:failed'

  // Sync
  | 'sync:started'
  | 'sync:completed'
  | 'sync:failed';

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
