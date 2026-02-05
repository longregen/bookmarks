import { db, type Bookmark, type Markdown, type BookmarkTag } from '../db/schema';
import { getSettings, saveSetting } from './settings';
import { events } from './events';
import { getErrorMessage } from './errors';
import {
  ServerApiClient,
  ServerApiError,
  type ServerBookmark,
  type ServerBookmarkFull,
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

const OFFLINE_QUEUE_KEY = 'serverSync:offlineQueue';

export class ServerSyncManager {
  private isSyncing = false;
  private isProcessingQueue = false;
  private offlineQueue: OfflineChange[] = [];
  private queueLoaded = false;

  private async ensureQueueLoaded(): Promise<void> {
    if (this.queueLoaded) return;
    await this.loadOfflineQueue();
  }

  private async loadOfflineQueue(): Promise<void> {
    try {
      if (__IS_WEB__) {
        const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
        if (stored !== null && stored !== '') {
          this.offlineQueue = JSON.parse(stored) as OfflineChange[];
        }
      } else {
        const result = await chrome.storage.local.get(OFFLINE_QUEUE_KEY);
        const stored = result[OFFLINE_QUEUE_KEY] as string | undefined;
        if (stored !== undefined && stored !== '') {
          this.offlineQueue = JSON.parse(stored) as OfflineChange[];
        }
      }
    } catch {
      this.offlineQueue = [];
    }
    this.queueLoaded = true;
  }

  private async saveOfflineQueue(): Promise<void> {
    try {
      if (__IS_WEB__) {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
      } else {
        await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: JSON.stringify(this.offlineQueue) });
      }
    } catch { /* best-effort persist */ }
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
      const allBookmarks: ServerBookmark[] = [];
      let offset = 0;
      let syncTimestamp = '';

      for (;;) {
        const response = await client.downloadFullSync({ offset });
        allBookmarks.push(...response.bookmarks);
        syncTimestamp = response.syncTimestamp;
        if (!response.hasMore) break;
        offset = allBookmarks.length;
      }

      await this.clearLocalCache();
      await this.storeBookmarks(allBookmarks);

      const syncTime = new Date(syncTimestamp).getTime();
      await saveSetting('serverLastSyncTime', syncTimestamp);
      await saveSetting('serverLastSyncError', '');
      await events.sync.completed('downloaded', allBookmarks.length);

      return { success: true, action: 'full_sync', message: `Full sync completed: ${allBookmarks.length} bookmarks`, timestamp: syncTime, bookmarkCount: allBookmarks.length };
    } catch (error) {
      const errorMessage = this.formatError(error);
      await saveSetting('serverLastSyncError', errorMessage);
      await events.sync.failed(errorMessage);
      return { success: false, action: 'full_sync', message: errorMessage, timestamp: Date.now(), bookmarkCount: 0 };
    } finally {
      this.isSyncing = false;
    }
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

      const response = await client.getChanges(lastSyncTime);

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

  async queueOfflineChange(change: OfflineChange): Promise<void> {
    await this.ensureQueueLoaded();
    const existingIndex = this.offlineQueue.findIndex(c => c.bookmarkId === change.bookmarkId);

    if (existingIndex < 0) {
      this.offlineQueue.push(change);
      await this.saveOfflineQueue();
      return;
    }

    const existing = this.offlineQueue[existingIndex];

    if (change.type === 'delete') {
      if (existing.type === 'create') {
        this.offlineQueue.splice(existingIndex, 1);
      } else {
        this.offlineQueue[existingIndex] = change;
      }
    } else if (change.type === 'update') {
      if (existing.type === 'create') {
        existing.data = { ...existing.data, ...change.data };
        existing.timestamp = change.timestamp;
      } else if (existing.type === 'update') {
        existing.data = { ...existing.data, ...change.data };
        existing.timestamp = change.timestamp;
      }
    } else {
      if (existing.type === 'delete') {
        this.offlineQueue[existingIndex] = change;
      }
    }

    await this.saveOfflineQueue();
  }

  async processOfflineQueue(): Promise<void> {
    await this.ensureQueueLoaded();
    if (this.isProcessingQueue || !(await this.isServerEnabled()) || this.offlineQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    try {
      const client = await ServerApiClient.fromSettings();
      const processedIndices = new Set<number>();

      for (let i = 0; i < this.offlineQueue.length; i++) {
        try {
          await this.sendOfflineChange(client, this.offlineQueue[i]);
          processedIndices.add(i);
        } catch {
          // Keep failed changes in queue
        }
      }

      this.offlineQueue = this.offlineQueue.filter((_, i) => !processedIndices.has(i));
      await this.saveOfflineQueue();
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
    await this.ensureQueueLoaded();
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
    const bookmarkRecords: Bookmark[] = [];
    const tagRecords: BookmarkTag[] = [];

    for (const serverBookmark of bookmarks) {
      bookmarkRecords.push({
        id: serverBookmark.id,
        url: serverBookmark.url,
        title: serverBookmark.title,
        html: '',
        status: serverBookmark.status as Bookmark['status'],
        errorMessage: serverBookmark.errorMessage ?? undefined,
        createdAt: new Date(serverBookmark.createdAt),
        updatedAt: new Date(serverBookmark.updatedAt),
      });

      for (const tagName of serverBookmark.tags) {
        tagRecords.push({ bookmarkId: serverBookmark.id, tagName, addedAt: now });
      }
    }

    await db.transaction('rw', [db.bookmarks, db.bookmarkTags], async () => {
      await db.bookmarks.bulkPut(bookmarkRecords);
      await db.bookmarkTags.bulkPut(tagRecords);
    });
  }

  async fetchBookmarkContent(bookmarkId: string): Promise<ServerBookmarkFull | null> {
    if (!(await this.isServerEnabled())) {
      return null;
    }

    try {
      const client = await ServerApiClient.fromSettings();
      const fullBookmark = await client.getBookmarkFull(bookmarkId);
      await this.cacheBookmarkContent(fullBookmark);
      return fullBookmark;
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound()) {
        return null;
      }
      console.error('Failed to fetch bookmark content:', getErrorMessage(error));
      return null;
    }
  }

  private async cacheBookmarkContent(fullBookmark: ServerBookmarkFull): Promise<void> {
    const now = new Date();
    await db.transaction('rw', [db.bookmarks, db.markdown, db.questionsAnswers], async () => {
      const existing = await db.bookmarks.get(fullBookmark.id);
      if (existing) {
        existing.html = fullBookmark.html ?? '';
        await db.bookmarks.put(existing);
      }

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

      if (fullBookmark.qaPairs.length > 0) {
        await db.questionsAnswers.where('bookmarkId').equals(fullBookmark.id).delete();

        await db.questionsAnswers.bulkPut(fullBookmark.qaPairs.map(qa => ({
          id: qa.id,
          bookmarkId: fullBookmark.id,
          question: qa.question,
          answer: qa.answer,
          embeddingQuestion: [],
          embeddingAnswer: [],
          embeddingBoth: [],
          createdAt: new Date(qa.createdAt),
          updatedAt: now,
        })));
      }
    });
  }

  private async upsertLocalBookmark(serverBookmark: ServerBookmark): Promise<void> {
    const now = new Date();
    await db.transaction('rw', [db.bookmarks, db.bookmarkTags], async () => {
      const bookmark: Bookmark = {
        id: serverBookmark.id,
        url: serverBookmark.url,
        title: serverBookmark.title,
        html: '',
        status: serverBookmark.status as Bookmark['status'],
        errorMessage: serverBookmark.errorMessage ?? undefined,
        createdAt: new Date(serverBookmark.createdAt),
        updatedAt: new Date(serverBookmark.updatedAt),
      };
      await db.bookmarks.put(bookmark);

      await db.bookmarkTags.where('bookmarkId').equals(serverBookmark.id).delete();
      await db.bookmarkTags.bulkPut(
        serverBookmark.tags.map(tagName => ({ bookmarkId: serverBookmark.id, tagName, addedAt: now }))
      );
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

