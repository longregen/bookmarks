/**
 * Event-driven messaging system for the extension
 *
 * Provides a pub/sub pattern for pushing updates from background to UI pages,
 * replacing inefficient polling patterns.
 */

export enum EventType {
  // Sync events
  SYNC_STATUS_CHANGED = 'sync_status_changed',

  // Job events
  JOB_CREATED = 'job_created',
  JOB_UPDATED = 'job_updated',
  JOB_COMPLETED = 'job_completed',
  JOB_FAILED = 'job_failed',

  // Database events
  BOOKMARK_CREATED = 'bookmark_created',
  BOOKMARK_UPDATED = 'bookmark_updated',
  BOOKMARK_DELETED = 'bookmark_deleted',
  TAG_CHANGED = 'tag_changed',
}

export interface EventMessage<T = any> {
  type: 'EVENT_UPDATE';
  eventType: EventType;
  data: T;
  timestamp: number;
}

export interface SyncStatusData {
  lastSyncTime: string | null;
  lastSyncError: string | null;
  isSyncing: boolean;
}

export interface JobUpdateData {
  jobId: string;
  status: string;
  progress: number;
  metadata?: any;
}

export interface BookmarkChangeData {
  bookmarkId: string;
  action: 'created' | 'updated' | 'deleted';
}

export interface TagChangeData {
  bookmarkId: string;
  tagName?: string;
}

/**
 * Broadcast an event update to all listening pages
 * Call this from the background/service worker
 */
export async function broadcastEvent(eventType: EventType, data: any): Promise<void> {
  const message: EventMessage = {
    type: 'EVENT_UPDATE',
    eventType,
    data,
    timestamp: Date.now(),
  };

  try {
    // Send to all extension pages (options, library, etc.)
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      if (tab.id && tab.url?.startsWith('chrome-extension://')) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Ignore errors for tabs that can't receive messages
        });
      }
    }

    // Note: We don't call chrome.runtime.sendMessage() here because:
    // 1. From the service worker, it would try to send to itself (no-op)
    // 2. Extension pages already receive messages via chrome.tabs.sendMessage()
    // 3. Calling sendMessage with no receiver causes "Receiving end does not exist" errors
  } catch (error) {
    console.error('Error broadcasting event:', error);
  }
}

/**
 * Listen for event updates
 * Call this from UI pages (options, library, etc.)
 *
 * @param eventType The type of event to listen for
 * @param callback Function to call when event occurs
 * @returns Cleanup function to stop listening
 */
export function onEvent<T = any>(
  eventType: EventType,
  callback: (data: T) => void
): () => void {
  const listener = (message: any) => {
    if (message.type === 'EVENT_UPDATE' && message.eventType === eventType) {
      callback(message.data);
    }
  };

  // Listen on both channels
  chrome.runtime.onMessage.addListener(listener);

  // Return cleanup function
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}

/**
 * Listen for multiple event types
 *
 * @param eventTypes Array of event types to listen for
 * @param callback Function to call when any event occurs
 * @returns Cleanup function to stop listening
 */
export function onEvents(
  eventTypes: EventType[],
  callback: (eventType: EventType, data: any) => void
): () => void {
  const listener = (message: any) => {
    if (message.type === 'EVENT_UPDATE' && eventTypes.includes(message.eventType)) {
      callback(message.eventType, message.data);
    }
  };

  chrome.runtime.onMessage.addListener(listener);

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}

/**
 * Helper to broadcast sync status changes
 */
export async function broadcastSyncStatus(status: SyncStatusData): Promise<void> {
  return broadcastEvent(EventType.SYNC_STATUS_CHANGED, status);
}

/**
 * Helper to broadcast job updates
 */
export async function broadcastJobUpdate(jobData: JobUpdateData): Promise<void> {
  const eventType =
    jobData.status === 'completed' ? EventType.JOB_COMPLETED :
    jobData.status === 'failed' ? EventType.JOB_FAILED :
    EventType.JOB_UPDATED;

  return broadcastEvent(eventType, jobData);
}

/**
 * Helper to broadcast bookmark changes
 */
export async function broadcastBookmarkChange(change: BookmarkChangeData): Promise<void> {
  const eventType =
    change.action === 'created' ? EventType.BOOKMARK_CREATED :
    change.action === 'updated' ? EventType.BOOKMARK_UPDATED :
    EventType.BOOKMARK_DELETED;

  return broadcastEvent(eventType, change);
}

/**
 * Helper to broadcast tag changes
 */
export async function broadcastTagChange(change: TagChangeData): Promise<void> {
  return broadcastEvent(EventType.TAG_CHANGED, change);
}
