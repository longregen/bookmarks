import { getErrorMessage } from './errors';
import type { Message } from './messages';

export type EventType =
  | 'BOOKMARK_UPDATED'
  | 'JOB_UPDATED'
  | 'SYNC_STATUS_UPDATED'
  | 'PROCESSING_COMPLETE'
  | 'TAG_UPDATED';

export interface EventData {
  type: EventType;
  payload?: unknown;
  timestamp: number;
}

export async function broadcastEvent(type: EventType, payload?: unknown): Promise<void> {
  const event: EventData = {
    type,
    payload,
    timestamp: Date.now(),
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- runtime check for test environments
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      await chrome.runtime.sendMessage({
        type: 'EVENT_BROADCAST',
        event,
      });
    } catch (error: unknown) {
      // Expected error when no listeners (e.g., no pages open)
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
    if (message.type === 'EVENT_BROADCAST') {
      listener(message.event);
    }
  };

  const webListener = (e: Event): void => {
    const customEvent = e as CustomEvent<EventData>;
    listener(customEvent.detail);
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- runtime check for test environments
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(chromeListener);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('bookmark-event', webListener);
  }

  return (): void => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- runtime check for test environments
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(chromeListener);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('bookmark-event', webListener);
    }
  };
}
