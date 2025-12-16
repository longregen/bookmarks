/**
 * Event notification system for broadcasting database and processing changes
 * Replaces polling with event-driven updates
 */

export type EventType =
  | 'BOOKMARK_UPDATED'
  | 'JOB_UPDATED'
  | 'SYNC_STATUS_UPDATED'
  | 'PROCESSING_COMPLETE';

export interface EventData {
  type: EventType;
  payload?: any;
  timestamp: number;
}

/**
 * Broadcast an event to all listening pages (options, library, popup)
 * This works in both extension and web contexts
 */
export async function broadcastEvent(type: EventType, payload?: any): Promise<void> {
  const event: EventData = {
    type,
    payload,
    timestamp: Date.now(),
  };

  // Extension context: broadcast via chrome.runtime.sendMessage
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('Receiving end does not exist')) {
        console.error('Error broadcasting event:', error);
      }
    }
  }

  // Web context: use custom events on window
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bookmark-event', { detail: event }));
  }
}

export type EventListener = (event: EventData) => void;

/**
 * Listen for events in UI pages (options, library, popup)
 * Automatically handles both extension and web contexts
 */
export function addEventListener(listener: EventListener): () => void {
  // Extension context: listen for chrome.runtime messages
  const chromeListener = (message: any) => {
    if (message.type === 'EVENT_BROADCAST' && message.event) {
      listener(message.event);
    }
  };

  // Web context: listen for custom events
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

  // Return cleanup function
  return () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.removeListener(chromeListener);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('bookmark-event', webListener);
    }
  };
}
