import { db, type Bookmark, type Markdown, type BookmarkTag } from '../db/schema';
import { getSettings, saveSetting } from './settings';
import { events } from './events';
import { getErrorMessage } from './errors';
import {
  ServerApiClient,
  ServerApiError,
  type ServerBookmark,
  type ServerBookmarkFull,
  type FullSyncDownloadResponse,
} from './server-api';

export type SyncAction = 'full_sync' | 'incremental_sync' | 'no_change';

export interface SyncResult {
  success: boolean;
  action: SyncAction;
  message: string;
  timestamp: number;
  bookmarkCount: number;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  lastSyncError: string | null;
  isSyncing: boolean;
  pendingChanges: number;
}

export type OfflineChangeType = 'create' | 'update' | 'delete';

export interface OfflineChange {
  type: OfflineChangeType;
  bookmarkId: string;
  data?: Partial<ServerBookmark>;
  timestamp: number;
}

// Re-export types from server-api for convenience
export type { ServerBookmark, ServerBookmarkFull, ServerQAPair, FullSyncDownloadResponse } from './server-api';

interface IncrementalSyncResponse {
  changes: {
    type: 'created' | 'updated' | 'deleted';
    bookmark?: ServerBookmark;
    bookmarkId?: string;
  }[];
  syncTimestamp: string;
}

const OFFLINE_QUEUE_KEY = 'serverSync:offlineQueue';

export class ServerSyncManager {
  private isSyncing = false;
  private isProcessingQueue = false;
  private offlineQueue: OfflineChange[] = [];

  constructor() {
    this.loadOfflineQueue();
  }

  private loadOfflineQueue(): void {
    try {
      const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (stored !== null && stored !== '') {
        this.offlineQueue = JSON.parse(stored) as OfflineChange[];
      }
    } catch {
      this.offlineQueue = [];
    }
  }

  private saveOfflineQueue(): void {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
    } catch {
      // Ignore storage errors
    }
  }

  private async isServerEnabled(): Promise<boolean> {
    const settings = await getSettings();
    return settings.serverEnabled && !!settings.serverUrl && !!settings.serverSessionToken;
  }

  async fullSync(): Promise<SyncResult> {
    if (!(await this.isServerEnabled())) {
      return { success: true, action: 'no_change', message: 'Server sync not enabled', timestamp: Date.now(), bookmarkCount: 0 };
    }

    if (this.isSyncing) {
      return { success: false, action: 'full_sync', message: 'Sync already in progress', timestamp: Date.now(), bookmarkCount: 0 };
    }

    this.isSyncing = true;
    await events.sync.started(false);

    try {
      const client = await ServerApiClient.fromSettings();
      const response = await this.fetchFullSync(client);

      await this.clearLocalCache();
      await this.storeBookmarks(response.bookmarks);

      const syncTime = new Date(response.syncTimestamp).getTime();
      await saveSetting('serverLastSyncTime', response.syncTimestamp);
      await saveSetting('serverLastSyncError', '');
      await events.sync.completed('downloaded', response.bookmarks.length);

      return { success: true, action: 'full_sync', message: `Full sync completed: ${response.bookmarks.length} bookmarks`, timestamp: syncTime, bookmarkCount: response.bookmarks.length };
    } catch (error) {
      const errorMessage = this.formatError(error);
      await saveSetting('serverLastSyncError', errorMessage);
      await events.sync.failed(errorMessage);
      return { success: false, action: 'full_sync', message: errorMessage, timestamp: Date.now(), bookmarkCount: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  private async fetchFullSync(client: ServerApiClient): Promise<FullSyncDownloadResponse> {
    return client.downloadFullSync();
  }

  async incrementalSync(): Promise<SyncResult> {
    if (!(await this.isServerEnabled())) {
      return { success: true, action: 'no_change', message: 'Server sync not enabled', timestamp: Date.now(), bookmarkCount: 0 };
    }

    if (this.isSyncing) {
      return { success: false, action: 'incremental_sync', message: 'Sync already in progress', timestamp: Date.now(), bookmarkCount: 0 };
    }

    this.isSyncing = true;
    await events.sync.started(false);

    try {
      await this.processOfflineQueue();

      const settings = await getSettings();
      const client = await ServerApiClient.fromSettings();
      const lastSyncTime = settings.serverLastSyncTime || new Date(0).toISOString();

      const response = await client.getChanges(lastSyncTime) as unknown as IncrementalSyncResponse;

      let changesApplied = 0;
      for (const change of response.changes) {
        if (change.type === 'deleted' && change.bookmarkId !== undefined && change.bookmarkId !== '') {
          await this.deleteLocalBookmark(change.bookmarkId);
          changesApplied++;
        } else if (change.bookmark !== undefined) {
          await this.upsertLocalBookmark(change.bookmark);
          changesApplied++;
        }
      }

      await saveSetting('serverLastSyncTime', response.syncTimestamp);
      await saveSetting('serverLastSyncError', '');

      const action: SyncAction = changesApplied > 0 ? 'incremental_sync' : 'no_change';
      await events.sync.completed(changesApplied > 0 ? 'downloaded' : 'no-change', changesApplied);

      return {
        success: true,
        action,
        message: changesApplied > 0 ? `Incremental sync: ${changesApplied} changes applied` : 'No changes since last sync',
        timestamp: new Date(response.syncTimestamp).getTime(),
        bookmarkCount: changesApplied,
      };
    } catch (error) {
      const errorMessage = this.formatError(error);
      await saveSetting('serverLastSyncError', errorMessage);
      await events.sync.failed(errorMessage);
      return { success: false, action: 'incremental_sync', message: errorMessage, timestamp: Date.now(), bookmarkCount: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof ServerApiError && error.isUnauthorized()) {
      return 'Session expired. Please log in again.';
    }
    return getErrorMessage(error);
  }

  queueOfflineChange(change: OfflineChange): void {
    const existingIndex = this.offlineQueue.findIndex(c => c.bookmarkId === change.bookmarkId);

    if (existingIndex < 0) {
      // No existing change for this bookmark, just add it
      this.offlineQueue.push(change);
      this.saveOfflineQueue();
      return;
    }

    const existing = this.offlineQueue[existingIndex];

    if (change.type === 'delete') {
      if (existing.type === 'create') {
        // Create + delete = no sync needed (bookmark never existed on server)
        this.offlineQueue.splice(existingIndex, 1);
      } else {
        // Update + delete = just delete (replace update with delete)
        this.offlineQueue[existingIndex] = change;
      }
    } else if (change.type === 'update') {
      if (existing.type === 'create') {
        // Create + update = merge update data into create
        existing.data = { ...existing.data, ...change.data };
        existing.timestamp = change.timestamp;
      } else if (existing.type === 'update') {
        // Update + update = merge and keep latest timestamp
        existing.data = { ...existing.data, ...change.data };
        existing.timestamp = change.timestamp;
      }
      // If existing is delete, ignore the update (can't update deleted bookmark)
    } else if (change.type === 'create') {
      if (existing.type === 'delete') {
        // Delete + create = replace with create (re-creating after delete)
        this.offlineQueue[existingIndex] = change;
      }
      // If existing is create or update, keep existing (shouldn't happen normally)
    }

    this.saveOfflineQueue();
  }

  async processOfflineQueue(): Promise<void> {
    if (this.isProcessingQueue || !(await this.isServerEnabled()) || this.offlineQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    try {
      const client = await ServerApiClient.fromSettings();
      const processedIds = new Set<string>();

      for (const change of [...this.offlineQueue]) {
        const key = `${change.bookmarkId}:${change.type}`;
        try {
          await this.sendOfflineChange(client, change);
          processedIds.add(key);
        } catch {
          // Keep failed changes in queue
        }
      }

      this.offlineQueue = this.offlineQueue.filter(c => !processedIds.has(`${c.bookmarkId}:${c.type}`));
      this.saveOfflineQueue();
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async sendOfflineChange(client: ServerApiClient, change: OfflineChange): Promise<void> {
    const data = change.data ?? {};
    switch (change.type) {
      case 'create':
        await client.createBookmark({
          url: data.url ?? '',
          title: data.title ?? '',
          html: data.html ?? '',
        });
        break;
      case 'update':
        await client.updateBookmark(change.bookmarkId, {
          title: data.title,
          html: data.html ?? undefined,
          tags: data.tags,
        });
        break;
      case 'delete':
        await client.deleteBookmark(change.bookmarkId);
        break;
    }
  }

  async getSyncStatus(): Promise<SyncStatus> {
    const settings = await getSettings();
    return {
      lastSyncTime: settings.serverLastSyncTime || null,
      lastSyncError: settings.serverLastSyncError || null,
      isSyncing: this.isSyncing,
      pendingChanges: this.offlineQueue.length,
    };
  }

  private async clearLocalCache(): Promise<void> {
    await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers, db.bookmarkTags], async () => {
      await db.bookmarks.clear();
      await db.markdown.clear();
      await db.questionsAnswers.clear();
      await db.bookmarkTags.clear();
    });
  }

  private async storeBookmarks(bookmarks: ServerBookmark[]): Promise<void> {
    const now = new Date();
    // Only store minimal data - full content fetched on-demand
    await db.transaction('rw', [db.bookmarks, db.bookmarkTags], async () => {
      for (const serverBookmark of bookmarks) {
        const bookmark: Bookmark = {
          id: serverBookmark.id,
          url: serverBookmark.url,
          title: serverBookmark.title,
          html: '', // Don't store html - fetch on-demand
          status: serverBookmark.status as Bookmark['status'],
          errorMessage: serverBookmark.errorMessage ?? undefined,
          createdAt: new Date(serverBookmark.createdAt),
          updatedAt: new Date(serverBookmark.updatedAt),
        };
        await db.bookmarks.put(bookmark);

        // Store tags (minimal data)
        for (const tagName of serverBookmark.tags) {
          const tag: BookmarkTag = { bookmarkId: serverBookmark.id, tagName, addedAt: now };
          await db.bookmarkTags.put(tag);
        }
      }
    });
  }

  /**
   * Fetch full bookmark content from server (html, markdown, Q&A pairs)
   * Results are cached locally in IndexedDB
   */
  async fetchBookmarkContent(bookmarkId: string): Promise<ServerBookmarkFull | null> {
    if (!(await this.isServerEnabled())) {
      return null;
    }

    try {
      const settings = await getSettings();
      const url = settings.serverUrl.replace(/\/$/, '');

      const response = await fetch(`${url}/api/v1/bookmarks/${bookmarkId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.serverSessionToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new ServerApiError(`Server error: ${response.status}`, response.status);
      }

      const fullBookmark = await response.json() as ServerBookmarkFull;

      // Cache the content locally
      await this.cacheBookmarkContent(fullBookmark);

      return fullBookmark;
    } catch (error) {
      console.error('Failed to fetch bookmark content:', getErrorMessage(error));
      return null;
    }
  }

  /**
   * Cache fetched bookmark content in IndexedDB
   */
  private async cacheBookmarkContent(fullBookmark: ServerBookmarkFull): Promise<void> {
    const now = new Date();
    await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers], async () => {
      // Update bookmark with html
      const existing = await db.bookmarks.get(fullBookmark.id);
      if (existing) {
        existing.html = fullBookmark.html ?? '';
        await db.bookmarks.put(existing);
      }

      // Store markdown
      if (fullBookmark.markdown !== null && fullBookmark.markdown !== '') {
        const markdown: Markdown = {
          id: `${fullBookmark.id}-md`,
          bookmarkId: fullBookmark.id,
          content: fullBookmark.markdown,
          createdAt: new Date(fullBookmark.createdAt),
          updatedAt: new Date(fullBookmark.updatedAt),
        };
        await db.markdown.put(markdown);
      }

      // Store Q&A pairs
      if (fullBookmark.qaPairs.length > 0) {
        // Clear existing Q&A pairs for this bookmark
        await db.questionsAnswers.where('bookmarkId').equals(fullBookmark.id).delete();

        for (const qa of fullBookmark.qaPairs) {
          await db.questionsAnswers.put({
            id: qa.id,
            bookmarkId: fullBookmark.id,
            question: qa.question,
            answer: qa.answer,
            embeddingQuestion: [], // Not needed for display
            embeddingAnswer: [],
            embeddingBoth: [],
            createdAt: new Date(qa.createdAt),
            updatedAt: now,
          });
        }
      }
    });
  }

  private async upsertLocalBookmark(serverBookmark: ServerBookmark): Promise<void> {
    const now = new Date();
    // Only store minimal data - full content fetched on-demand
    await db.transaction('rw', [db.bookmarks, db.bookmarkTags], async () => {
      const bookmark: Bookmark = {
        id: serverBookmark.id,
        url: serverBookmark.url,
        title: serverBookmark.title,
        html: '', // Don't store html - fetch on-demand
        status: serverBookmark.status as Bookmark['status'],
        errorMessage: serverBookmark.errorMessage ?? undefined,
        createdAt: new Date(serverBookmark.createdAt),
        updatedAt: new Date(serverBookmark.updatedAt),
      };
      await db.bookmarks.put(bookmark);

      await db.bookmarkTags.where('bookmarkId').equals(serverBookmark.id).delete();
      for (const tagName of serverBookmark.tags) {
        const tag: BookmarkTag = { bookmarkId: serverBookmark.id, tagName, addedAt: now };
        await db.bookmarkTags.put(tag);
      }
    });
  }

  private async deleteLocalBookmark(bookmarkId: string): Promise<void> {
    await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers, db.bookmarkTags], async () => {
      await db.bookmarks.delete(bookmarkId);
      await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
      await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();
      await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).delete();
    });
  }
}

export const serverSync = new ServerSyncManager();

export async function syncWithServer(): Promise<SyncResult> {
  return serverSync.incrementalSync();
}

/**
 * Fetch full bookmark content from server (on-demand)
 * Returns cached content if available, otherwise fetches from server
 */
export async function fetchBookmarkContent(bookmarkId: string): Promise<ServerBookmarkFull | null> {
  return serverSync.fetchBookmarkContent(bookmarkId);
}
