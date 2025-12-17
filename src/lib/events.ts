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
  payload?: any;
  timestamp: number;
}

export async function broadcastEvent(type: EventType, payload?: any): Promise<void> {
  const event: EventData = {
    type,
    payload,
    timestamp: Date.now(),
  };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      // Use sendMessage with no specific target - broadcasts to all listeners
      await chrome.runtime.sendMessage({
        type: 'EVENT_BROADCAST',
        event,
      });
    } catch (error: unknown) {
      // Ignore errors when no listeners (e.g., no pages open)
      // This is expected behavior
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
  const chromeListener = (message: Message) => {
    if (message.type === 'EVENT_BROADCAST' && message.event) {
      listener(message.event);
    }
  };

  const webListener = (e: Event) => {
    const customEvent = e as CustomEvent<EventData>;
    listener(customEvent.detail);
  };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(chromeListener);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('bookmark-event', webListener);
  }

  return () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.removeListener(chromeListener);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('bookmark-event', webListener);
    }
  };
}
